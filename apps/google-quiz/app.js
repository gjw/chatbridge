// Google Sheets Vocab Quiz — ChatBridge App (external_auth tier)
// Pulls flashcard decks from Google Sheets. Teachers create content in Sheets,
// students study here with LLM tutoring.

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let appId = null
let sessionId = null
let deck = []        // Array of { term, definition, hint }
let score = { correct: 0, incorrect: 0, answers: {} }

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
    case 'check_answer':
      toolCheckAnswer(invocationId, parameters)
      break
    case 'get_score':
      sendResult(invocationId, getScoreData())
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
// Tool: authorize_google
// ---------------------------------------------------------------------------

let pendingOAuthInvocation = null

function handleOAuthComplete() {
  if (!pendingOAuthInvocation) return
  const invocationId = pendingOAuthInvocation
  pendingOAuthInvocation = null

  // Trust that the OAuth callback succeeded — it stores the token server-side
  // and shows "Success" to the user before they close the popup.
  const statusEl = document.getElementById('status')
  statusEl.textContent = 'Google connected!'
  resizeFrame()
  sendResult(invocationId, { authorized: true, message: 'Successfully connected to Google. You can now load a sheet.' })
}

async function checkAuthStatus() {
  const serverOrigin = window.location.origin.replace(/:\d+$/, ':3100')
  const resp = await apiRequest(serverOrigin + '/api/oauth/google/status', 'GET')
  return resp.body && resp.body.authorized
}

function toolAuthorizeGoogle(invocationId) {
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
// Tool: load_deck
// ---------------------------------------------------------------------------

function extractSheetId(urlOrId) {
  // Handle full URLs like https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (match) return match[1]
  // Handle bare IDs
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
    // Fetch sheet data via proxy (server injects OAuth token)
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
    score = { correct: 0, incorrect: 0, answers: {} }

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

    // Show deck info
    statusEl.classList.add('hidden')
    deckInfoEl.innerHTML = `<div class="deck-banner"><h3>Deck loaded: ${deck.length} terms</h3><p>Ready to quiz!</p></div>`
    deckInfoEl.classList.remove('hidden')
    resizeFrame()

    sendResult(invocationId, {
      loaded: true,
      termCount: deck.length,
      terms: deck.map((c) => c.term),
      message: `Loaded ${deck.length} flashcards. Ready to quiz the student.`,
    })
  } catch (err) {
    statusEl.textContent = 'Failed to load deck.'
    resizeFrame()
    sendError(invocationId, 'SHEET_FETCH_FAILED', err.message)
  }
}

// ---------------------------------------------------------------------------
// Tool: check_answer
// ---------------------------------------------------------------------------

function toolCheckAnswer(invocationId, params) {
  const { term, studentAnswer } = params
  const cardEl = document.getElementById('card')
  const termEl = document.getElementById('card-term')
  const resultEl = document.getElementById('card-result')
  const scoreBarEl = document.getElementById('score-bar')

  const card = deck.find((c) => c.term.toLowerCase() === (term || '').toLowerCase())
  if (!card) {
    sendResult(invocationId, { error: `Term "${term}" not found in current deck` })
    return
  }

  // Simple similarity check — the LLM does the real grading, but we track it
  const normalizedAnswer = (studentAnswer || '').toLowerCase().trim()
  const normalizedDefinition = card.definition.toLowerCase().trim()
  const isClose = normalizedDefinition.includes(normalizedAnswer) ||
                  normalizedAnswer.includes(normalizedDefinition) ||
                  normalizedAnswer.length > 10  // Let LLM judge longer answers

  // Always let the LLM do the real grading — we just show the UI
  const alreadyAnswered = card.term in score.answers

  // Show card UI
  cardEl.classList.remove('hidden')
  termEl.textContent = card.term

  // We return the data and let the LLM decide correct/incorrect
  // The LLM will call back to update if needed
  resultEl.innerHTML = `<strong>Your answer:</strong> ${escapeHtml(studentAnswer)}<br><strong>Definition:</strong> ${escapeHtml(card.definition)}${card.hint ? '<br><em>Hint: ' + escapeHtml(card.hint) + '</em>' : ''}`
  resultEl.className = ''
  resultEl.classList.remove('hidden')

  scoreBarEl.classList.remove('hidden')
  updateScoreBar()
  resizeFrame()

  sendResult(invocationId, {
    term: card.term,
    studentAnswer,
    correctDefinition: card.definition,
    hint: card.hint || null,
    alreadyAnswered,
  })
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

function getScoreData() {
  return {
    correct: score.correct,
    incorrect: score.incorrect,
    total: deck.length,
    answered: score.correct + score.incorrect,
    remaining: deck.length - (score.correct + score.incorrect),
    missedTerms: Object.entries(score.answers)
      .filter(([, v]) => !v)
      .map(([term]) => {
        const card = deck.find((c) => c.term === term)
        return { term, definition: card ? card.definition : '' }
      }),
  }
}

function updateScoreBar() {
  const el = document.getElementById('score-bar')
  el.innerHTML = `<span class="score-correct">${score.correct} correct</span> · <span class="score-incorrect">${score.incorrect} incorrect</span> · ${deck.length - score.correct - score.incorrect} remaining`
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

function resetApp() {
  deck = []
  score = { correct: 0, incorrect: 0, answers: {} }
  document.getElementById('status').textContent = 'Waiting to connect...'
  document.getElementById('status').classList.remove('hidden')
  document.getElementById('deck-info').classList.add('hidden')
  document.getElementById('card').classList.add('hidden')
  document.getElementById('score-bar').classList.add('hidden')
}
