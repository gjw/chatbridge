// Google Sheets Vocab Quiz — State-machine next_turn pattern
// App is the state machine. LLM is a stateless judge.
// Flow: authorize_google → load_deck → next_turn loop
// States (after deck loaded): awaiting_answer → awaiting_judgment → (loop or complete)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let appId = null
let sessionId = null
let deck = []        // Array of { term, definition, hint }
let currentIndex = 0
let results = []     // Array of { term, definition, studentAnswer, isCorrect }
let appState = 'no_deck' // no_deck | awaiting_answer | awaiting_judgment | complete
let pendingStudentAnswer = ''
let googleAuthorized = false

// ---------------------------------------------------------------------------
// Bridge protocol
// ---------------------------------------------------------------------------

window.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('bridge:')) return

  switch (msg.type) {
    case 'bridge:init':
      appId = msg.appId
      sessionId = msg.sessionId
      window.parent.postMessage({ type: 'bridge:ready' }, '*')
      break
    case 'bridge:tool:invoke':
      handleToolInvoke(msg)
      break
    case 'bridge:api:response':
      handleApiResponse(msg)
      break
    case 'bridge:oauth:complete':
      handleOAuthComplete(msg)
      break
    case 'bridge:destroy':
      resetApp()
      break
  }
})

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

function handleToolInvoke(msg) {
  const { invocationId, toolName, parameters } = msg
  switch (toolName) {
    case 'authorize_google':
      toolAuthorizeGoogle(invocationId)
      break
    case 'load_deck':
      toolLoadDeck(invocationId, parameters)
      break
    case 'next_turn':
      handleNextTurn(invocationId, parameters || {})
      break
    default:
      sendError(invocationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`)
  }
}

// ---------------------------------------------------------------------------
// Bridge helpers
// ---------------------------------------------------------------------------

function sendResult(invocationId, result) {
  window.parent.postMessage({ type: 'bridge:tool:result', invocationId, result }, '*')
}

function sendError(invocationId, code, message) {
  window.parent.postMessage({ type: 'bridge:tool:error', invocationId, error: { code, message } }, '*')
}

function resizeFrame() {
  const height = document.getElementById('app').offsetHeight + 20
  window.parent.postMessage({ type: 'bridge:ui:resize', height: Math.min(Math.max(height, 100), 800) }, '*')
}

// ---------------------------------------------------------------------------
// API request helpers (via bridge proxy)
// ---------------------------------------------------------------------------

const pendingRequests = new Map()

function apiRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const requestId = 'req-' + Math.random().toString(36).slice(2)
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('API request timed out'))
    }, 15000)
    pendingRequests.set(requestId, { resolve, reject, timeout })
    window.parent.postMessage({
      type: 'bridge:api:request', requestId, url,
      method: method || 'GET', headers: headers || {}, body: body || undefined,
    }, '*')
  })
}

function handleApiResponse(msg) {
  const pending = pendingRequests.get(msg.requestId)
  if (!pending) return
  pendingRequests.delete(msg.requestId)
  clearTimeout(pending.timeout)
  pending.resolve({ status: msg.status, body: msg.body })
}

// ---------------------------------------------------------------------------
// Tool: authorize_google (unchanged)
// ---------------------------------------------------------------------------

let pendingOAuthInvocation = null

function handleOAuthComplete() {
  if (!pendingOAuthInvocation) return
  const invocationId = pendingOAuthInvocation
  pendingOAuthInvocation = null

  const statusEl = document.getElementById('status')
  googleAuthorized = true
  statusEl.textContent = 'Google connected!'
  resizeFrame()
  sendResult(invocationId, { authorized: true, message: 'Successfully connected to Google. You can now load a sheet.' })
}

function toolAuthorizeGoogle(invocationId) {
  if (googleAuthorized) {
    sendResult(invocationId, { authorized: true, message: 'Already connected to Google.' })
    return
  }

  const statusEl = document.getElementById('status')

  statusEl.innerHTML = '<button class="connect-btn" id="connect-btn">Connect Google</button><p style="margin-top:8px;color:#57606a;font-size:13px;">Sign in to access your teacher\'s flashcard sheets</p>'
  resizeFrame()

  document.getElementById('connect-btn').addEventListener('click', () => {
    const btn = document.getElementById('connect-btn')
    btn.disabled = true
    btn.textContent = 'Connecting...'
    pendingOAuthInvocation = invocationId
    window.parent.postMessage({
      type: 'bridge:oauth:request',
      requestId: 'oauth-' + Math.random().toString(36).slice(2),
      provider: 'google',
    }, '*')
  })
}

// ---------------------------------------------------------------------------
// Tool: load_deck (modified to auto-start quiz state)
// ---------------------------------------------------------------------------

function extractSheetId(urlOrId) {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (match) return match[1]
  if (/^[a-zA-Z0-9_-]+$/.test(urlOrId)) return urlOrId
  return null
}

async function toolLoadDeck(invocationId, params) {
  const statusEl = document.getElementById('status')
  const deckInfoEl = document.getElementById('deck-info')

  const sheetId = extractSheetId(params.sheetUrl || '')
  if (!sheetId) {
    sendError(invocationId, 'INVALID_SHEET', 'Could not parse Google Sheets URL or ID')
    return
  }

  statusEl.textContent = 'Loading deck from Google Sheets...'
  statusEl.classList.remove('hidden')
  deckInfoEl.classList.add('hidden')
  resizeFrame()

  try {
    const resp = await apiRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:C?majorDimension=ROWS`,
      'GET',
      { Accept: 'application/json' },
    )

    if (resp.status === 401 || resp.status === 403) {
      statusEl.textContent = 'Not authorized or no access to this sheet. Connect Google first.'
      resizeFrame()
      sendResult(invocationId, { error: 'Not authorized. Call authorize_google first, or check sheet sharing settings.' })
      return
    }

    if (resp.status !== 200) {
      statusEl.textContent = 'Failed to load sheet.'
      resizeFrame()
      sendError(invocationId, 'SHEET_FETCH_FAILED', `Google API returned status ${resp.status}`)
      return
    }

    const values = resp.body.values || []
    if (values.length < 2) {
      statusEl.textContent = 'Sheet is empty or has no data rows.'
      resizeFrame()
      sendResult(invocationId, { error: 'Sheet has no flashcard data. Expected columns: Term, Definition, Hint (optional)' })
      return
    }

    // Parse: first row is header, rest are cards
    deck = []
    for (let i = 1; i < values.length; i++) {
      const row = values[i]
      const term = (row[0] || '').trim()
      const definition = (row[1] || '').trim()
      const hint = (row[2] || '').trim()
      if (term && definition) {
        deck.push({ term, definition, hint })
      }
    }

    if (deck.length === 0) {
      statusEl.textContent = 'No valid flashcards found in sheet.'
      resizeFrame()
      sendResult(invocationId, { error: 'No valid rows found. Each row needs at least Term and Definition.' })
      return
    }

    // Shuffle deck and initialize quiz state
    deck = shuffleArray(deck)
    currentIndex = 0
    results = []
    pendingStudentAnswer = ''
    appState = 'awaiting_answer'

    // Show deck info
    statusEl.classList.add('hidden')
    deckInfoEl.innerHTML = `<div class="deck-banner"><h3>Deck loaded: ${deck.length} terms</h3><p>Ready to quiz!</p></div>`
    deckInfoEl.classList.remove('hidden')
    renderQuizCard()
    resizeFrame()

    // Return first question alongside load confirmation
    const firstCard = deck[0]
    sendResult(invocationId, {
      loaded: true,
      termCount: deck.length,
      state: 'awaiting_answer',
      term: firstCard.term,
      questionNumber: 1,
      totalQuestions: deck.length,
      message: `Loaded ${deck.length} flashcards. Ask the student: what is "${firstCard.term}"?`,
    })
  } catch (err) {
    statusEl.textContent = 'Failed to load deck.'
    resizeFrame()
    sendError(invocationId, 'SHEET_FETCH_FAILED', err.message)
  }
}

// ---------------------------------------------------------------------------
// next_turn state machine
// ---------------------------------------------------------------------------

function handleNextTurn(invocationId, input) {
  switch (appState) {
    case 'no_deck':
      sendResult(invocationId, {
        state: 'no_deck',
        message: 'No deck loaded. Call load_deck first.',
      })
      break
    case 'awaiting_answer':
      handleAwaitingAnswer(invocationId, input)
      break
    case 'awaiting_judgment':
      handleAwaitingJudgment(invocationId, input)
      break
    case 'complete':
      handleComplete(invocationId)
      break
    default:
      sendError(invocationId, 'INVALID_STATE', `Unexpected state: ${appState}`)
  }
}

function handleAwaitingAnswer(invocationId, input) {
  const studentAnswer = (input.studentAnswer || '').trim()
  const card = deck[currentIndex]

  if (!studentAnswer) {
    // No answer — return current question
    sendResult(invocationId, {
      state: 'awaiting_answer',
      term: card.term,
      questionNumber: currentIndex + 1,
      totalQuestions: deck.length,
    })
    return
  }

  // Store answer, transition to judgment
  pendingStudentAnswer = studentAnswer
  appState = 'awaiting_judgment'

  // Update UI to show the answer being checked
  showAnswerOnCard(card.term, studentAnswer)
  resizeFrame()

  sendResult(invocationId, {
    state: 'awaiting_judgment',
    term: card.term,
    definition: card.definition,
    hint: card.hint || null,
    studentAnswer,
    questionNumber: currentIndex + 1,
    totalQuestions: deck.length,
  })
}

function handleAwaitingJudgment(invocationId, input) {
  if (typeof input.correct !== 'boolean') {
    // No judgment — re-send judgment data
    const card = deck[currentIndex]
    sendResult(invocationId, {
      state: 'awaiting_judgment',
      term: card.term,
      definition: card.definition,
      hint: card.hint || null,
      studentAnswer: pendingStudentAnswer,
      questionNumber: currentIndex + 1,
      totalQuestions: deck.length,
    })
    return
  }

  const isCorrect = input.correct
  const card = deck[currentIndex]

  // Record result
  results.push({
    term: card.term,
    definition: card.definition,
    studentAnswer: pendingStudentAnswer,
    isCorrect,
  })

  // Show feedback on card
  showFeedbackOnCard(isCorrect, card.definition)
  updateScoreBar()

  // Advance
  currentIndex++
  pendingStudentAnswer = ''

  if (currentIndex >= deck.length) {
    appState = 'complete'
    setTimeout(() => {
      renderEndScreen()
      resizeFrame()
    }, 1500)

    sendResult(invocationId, {
      state: 'complete',
      score: getScoreData(),
    })
    return
  }

  // Next question
  appState = 'awaiting_answer'
  const nextCard = deck[currentIndex]

  setTimeout(() => {
    renderQuizCard()
    resizeFrame()
  }, 1500)

  sendResult(invocationId, {
    state: 'awaiting_answer',
    term: nextCard.term,
    questionNumber: currentIndex + 1,
    totalQuestions: deck.length,
    previousResult: { correct: isCorrect, term: card.term },
  })
}

function handleComplete(invocationId) {
  sendResult(invocationId, {
    state: 'complete',
    score: getScoreData(),
  })
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

function getScoreData() {
  const correctCount = results.filter((r) => r.isCorrect).length
  const missed = results
    .filter((r) => !r.isCorrect)
    .map((r) => ({ term: r.term, definition: r.definition, studentAnswer: r.studentAnswer }))

  return {
    correct: correctCount,
    total: results.length,
    missed,
  }
}

function updateScoreBar() {
  const el = document.getElementById('score-bar')
  if (!el) return
  const correctCount = results.filter((r) => r.isCorrect).length
  const incorrectCount = results.filter((r) => !r.isCorrect).length
  const remaining = deck.length - results.length
  el.innerHTML = `<span class="score-correct">${correctCount} correct</span> · <span class="score-incorrect">${incorrectCount} incorrect</span> · ${remaining} remaining`
  el.classList.remove('hidden')
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderQuizCard() {
  if (currentIndex >= deck.length) {
    renderEndScreen()
    return
  }

  const card = deck[currentIndex]
  const cardEl = document.getElementById('card')
  const termEl = document.getElementById('card-term')
  const resultEl = document.getElementById('card-result')

  cardEl.classList.remove('hidden')
  termEl.textContent = card.term
  resultEl.innerHTML = `<em style="color:#57606a;">Waiting for answer...</em>`
  resultEl.className = ''
  resultEl.classList.remove('hidden')
  resizeFrame()
}

function showAnswerOnCard(term, studentAnswer) {
  const termEl = document.getElementById('card-term')
  const resultEl = document.getElementById('card-result')

  termEl.textContent = term
  resultEl.innerHTML = `<strong>Answer:</strong> ${escapeHtml(studentAnswer)}<br><em style="color:#57606a;">Checking...</em>`
  resultEl.className = ''
}

function showFeedbackOnCard(isCorrect, definition) {
  const cardEl = document.getElementById('card')
  const resultEl = document.getElementById('card-result')

  cardEl.classList.remove('hidden')
  resultEl.className = isCorrect ? 'correct' : 'incorrect'
  resultEl.innerHTML = `<strong>${isCorrect ? 'Correct!' : 'Incorrect'}</strong><br><strong>Definition:</strong> ${escapeHtml(definition)}`
}

function renderEndScreen() {
  const cardEl = document.getElementById('card')
  const termEl = document.getElementById('card-term')
  const resultEl = document.getElementById('card-result')

  cardEl.classList.remove('hidden')
  const score = getScoreData()
  termEl.textContent = `Quiz Complete: ${score.correct}/${score.total}`

  if (score.missed.length > 0) {
    let html = '<div style="margin-top:8px;"><strong>Missed:</strong><ul style="margin:4px 0;padding-left:20px;">'
    for (const m of score.missed) {
      html += `<li><strong>${escapeHtml(m.term)}</strong>: ${escapeHtml(m.definition)}</li>`
    }
    html += '</ul></div>'
    resultEl.innerHTML = html
  } else {
    resultEl.innerHTML = '<strong>Perfect score!</strong>'
  }
  resultEl.className = ''
  resultEl.classList.remove('hidden')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

function resetApp() {
  deck = []
  currentIndex = 0
  results = []
  appState = 'no_deck'
  pendingStudentAnswer = ''
  googleAuthorized = false
  document.getElementById('status').textContent = 'Waiting to connect...'
  document.getElementById('status').classList.remove('hidden')
  document.getElementById('deck-info').classList.add('hidden')
  document.getElementById('card').classList.add('hidden')
  const scoreBar = document.getElementById('score-bar')
  if (scoreBar) scoreBar.classList.add('hidden')
}
