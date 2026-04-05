// Vocabulary Quiz App — State-machine next_turn pattern
// App is the state machine. LLM is a stateless judge.
// States: idle → awaiting_answer → awaiting_judgment → (loop or complete)

/* global DECKS */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let appId = null
let sessionId = null
let currentDeckName = ''
let questions = []       // Shuffled copy of the active deck
let currentIndex = 0     // Index of current question
let results = []         // Array of {question, correctAnswer, studentAnswer, isCorrect}
let appState = 'idle'    // idle | awaiting_answer | awaiting_judgment | complete
let feedbackTimeout = null
let pendingStudentAnswer = '' // Held between awaiting_answer → awaiting_judgment

// ---------------------------------------------------------------------------
// Bridge Protocol
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

    case 'bridge:destroy':
      resetQuiz()
      break
  }
})

function sendResult(invocationId, result) {
  window.parent.postMessage({
    type: 'bridge:tool:result',
    invocationId,
    result,
  }, '*')
}

function sendError(invocationId, code, message) {
  window.parent.postMessage({
    type: 'bridge:tool:error',
    invocationId,
    error: { code, message },
  }, '*')
}

function resizeFrame() {
  const height = document.getElementById('app').offsetHeight + 20
  window.parent.postMessage({
    type: 'bridge:ui:resize',
    height: Math.min(Math.max(height, 200), 600),
  }, '*')
}

// ---------------------------------------------------------------------------
// Tool Handler — single next_turn entry point
// ---------------------------------------------------------------------------

function handleToolInvoke(msg) {
  const { invocationId, toolName, parameters } = msg

  if (toolName !== 'next_turn') {
    sendError(invocationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`)
    return
  }

  const input = parameters || {}

  // State machine dispatch
  switch (appState) {
    case 'idle':
      handleIdle(invocationId, input)
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

// ---------------------------------------------------------------------------
// State: idle — waiting for a deck to start
// ---------------------------------------------------------------------------

function handleIdle(invocationId, input) {
  const deckName = (input.deck || '').toLowerCase()

  if (!deckName) {
    sendResult(invocationId, {
      state: 'idle',
      message: 'No quiz active. Provide a deck name to start.',
      availableDecks: Object.keys(DECKS),
    })
    return
  }

  const deck = DECKS[deckName]
  if (!deck) {
    sendError(invocationId, 'INVALID_DECK', `Unknown deck: "${deckName}". Available: ${Object.keys(DECKS).join(', ')}`)
    return
  }

  // Start the quiz
  currentDeckName = deckName
  questions = shuffleArray([...deck])
  currentIndex = 0
  results = []
  pendingStudentAnswer = ''
  appState = 'awaiting_answer'

  if (feedbackTimeout) {
    clearTimeout(feedbackTimeout)
    feedbackTimeout = null
  }

  renderCard()
  updateScoreCounter()
  showMessage('')
  resizeFrame()

  sendResult(invocationId, {
    state: 'awaiting_answer',
    question: questions[0].question,
    questionNumber: 1,
    totalQuestions: questions.length,
    deck: deckName,
  })
}

// ---------------------------------------------------------------------------
// State: awaiting_answer — app shows question, LLM relays student answer
// ---------------------------------------------------------------------------

function handleAwaitingAnswer(invocationId, input) {
  const studentAnswer = (input.studentAnswer || '').trim()

  if (!studentAnswer) {
    // No answer provided — return current state
    const q = questions[currentIndex]
    sendResult(invocationId, {
      state: 'awaiting_answer',
      question: q.question,
      questionNumber: currentIndex + 1,
      totalQuestions: questions.length,
      deck: currentDeckName,
    })
    return
  }

  // Store the answer and transition to awaiting_judgment
  const q = questions[currentIndex]
  pendingStudentAnswer = studentAnswer
  appState = 'awaiting_judgment'

  sendResult(invocationId, {
    state: 'awaiting_judgment',
    question: q.question,
    correctAnswer: q.answer,
    studentAnswer,
    questionNumber: currentIndex + 1,
    totalQuestions: questions.length,
  })
}

// ---------------------------------------------------------------------------
// State: awaiting_judgment — LLM decides if the answer was correct
// ---------------------------------------------------------------------------

function handleAwaitingJudgment(invocationId, input) {
  if (typeof input.correct !== 'boolean') {
    // No judgment provided — re-send judgment request
    const q = questions[currentIndex]
    sendResult(invocationId, {
      state: 'awaiting_judgment',
      question: q.question,
      correctAnswer: q.answer,
      studentAnswer: pendingStudentAnswer,
      questionNumber: currentIndex + 1,
      totalQuestions: questions.length,
    })
    return
  }

  const isCorrect = input.correct
  const q = questions[currentIndex]

  // Record result
  results.push({
    question: q.question,
    correctAnswer: q.answer,
    studentAnswer: pendingStudentAnswer,
    isCorrect,
  })

  // Show feedback
  showFeedback(isCorrect, q.answer)
  updateScoreCounter()

  // Advance
  currentIndex++
  pendingStudentAnswer = ''

  if (currentIndex >= questions.length) {
    // Quiz complete
    appState = 'complete'

    // Delay end screen render so feedback shows briefly
    if (feedbackTimeout) clearTimeout(feedbackTimeout)
    feedbackTimeout = setTimeout(() => {
      feedbackTimeout = null
      renderEndScreen()
      resizeFrame()
    }, 1500)

    sendResult(invocationId, {
      state: 'complete',
      score: getScoreData(),
    })
    return
  }

  // Next question — delay card render so feedback shows
  appState = 'awaiting_answer'

  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  feedbackTimeout = setTimeout(() => {
    feedbackTimeout = null
    renderCard()
    resizeFrame()
  }, 1500)

  sendResult(invocationId, {
    state: 'awaiting_answer',
    question: questions[currentIndex].question,
    questionNumber: currentIndex + 1,
    totalQuestions: questions.length,
    deck: currentDeckName,
    previousResult: { correct: isCorrect, question: q.question },
  })
}

// ---------------------------------------------------------------------------
// State: complete — quiz finished
// ---------------------------------------------------------------------------

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
    .map((r) => ({ question: r.question, correctAnswer: r.correctAnswer, studentAnswer: r.studentAnswer }))

  return {
    correct: correctCount,
    total: results.length,
    deck: currentDeckName,
    missed,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderCard() {
  const card = document.getElementById('card')
  card.className = ''

  if (appState === 'complete' || currentIndex >= questions.length) {
    renderEndScreen()
    return
  }

  const q = questions[currentIndex]

  card.innerHTML = `
    <span class="deck-badge">${escapeHtml(currentDeckName)}</span>
    <span class="question-number">Question ${currentIndex + 1} of ${questions.length}</span>
    <span class="question-text">${escapeHtml(q.question)}</span>
  `
}

function showFeedback(isCorrect, correctAnswer) {
  const card = document.getElementById('card')
  card.className = isCorrect ? 'correct' : 'incorrect'

  const feedbackClass = isCorrect ? 'correct' : 'incorrect'
  const feedbackText = isCorrect ? 'Correct!' : 'Incorrect'

  let html = `
    <span class="feedback-text ${feedbackClass}">${feedbackText}</span>
  `

  if (!isCorrect) {
    html += `<span class="correct-answer">Answer: ${escapeHtml(correctAnswer)}</span>`
  }

  card.innerHTML = html
  resizeFrame()
}

function renderEndScreen() {
  const card = document.getElementById('card')
  card.className = ''

  const correctCount = results.filter((r) => r.isCorrect).length
  const missed = results.filter((r) => !r.isCorrect)

  let html = `
    <span class="deck-badge">${escapeHtml(currentDeckName)}</span>
    <span class="end-score">${correctCount}/${results.length}</span>
    <span class="end-label">Quiz Complete</span>
  `

  if (missed.length > 0) {
    html += '<div class="missed-list"><h3>Missed Questions</h3>'
    for (const m of missed) {
      html += `
        <div class="missed-item">
          <div class="q">${escapeHtml(m.question)}</div>
          <div class="a">${escapeHtml(m.correctAnswer)}</div>
        </div>
      `
    }
    html += '</div>'
  }

  card.innerHTML = html
}

function updateScoreCounter() {
  const el = document.getElementById('score-counter')
  if (results.length === 0) {
    el.textContent = ''
    return
  }
  const correct = results.filter((r) => r.isCorrect).length
  el.textContent = `${correct}/${results.length} correct`
}

// ---------------------------------------------------------------------------
// UI Helpers
// ---------------------------------------------------------------------------

function showMessage(text) {
  document.getElementById('message').textContent = text
}

function escapeHtml(str) {
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

function resetQuiz() {
  currentDeckName = ''
  questions = []
  currentIndex = 0
  results = []
  appState = 'idle'
  pendingStudentAnswer = ''
  if (feedbackTimeout) {
    clearTimeout(feedbackTimeout)
    feedbackTimeout = null
  }
  document.getElementById('card').innerHTML = '<span id="status">Waiting to start...</span>'
  document.getElementById('card').className = ''
  document.getElementById('score-counter').textContent = ''
  showMessage('')
}

// Init
setTimeout(() => {
  if (!appId) {
    document.getElementById('card').innerHTML = '<span id="status">Quiz app loaded. Awaiting bridge connection...</span>'
  }
}, 1000)
