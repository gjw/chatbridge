// Vocabulary Quiz App — ChatBridge Bridge Protocol Implementation
// Display-only: students answer via chat, LLM relays to check_answer.

/* global DECKS */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let appId = null
let sessionId = null
let currentDeckName = ''
let questions = []       // Shuffled copy of the active deck
let currentIndex = 0     // Index of current question
let results = []         // Array of {question, studentAnswer, correctAnswer, isCorrect}
let quizActive = false
let feedbackTimeout = null

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
// Tool Handlers
// ---------------------------------------------------------------------------

function handleToolInvoke(msg) {
  const { invocationId, toolName, parameters } = msg

  switch (toolName) {
    case 'start_quiz':
      toolStartQuiz(invocationId, parameters)
      break
    case 'check_answer':
      toolCheckAnswer(invocationId, parameters)
      break
    case 'get_score':
      sendResult(invocationId, toolGetScore())
      break
    default:
      sendError(invocationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`)
  }
}

function toolStartQuiz(invocationId, params) {
  // If quiz is already active, return current state instead of restarting
  if (quizActive && questions.length > 0) {
    const q = questions[currentIndex]
    sendResult(invocationId, {
      alreadyActive: true,
      deck: currentDeckName,
      questionNumber: currentIndex + 1,
      totalQuestions: questions.length,
      question: q.question,
      answeredSoFar: results.length,
    })
    return
  }

  const deckName = (params.deck || 'science').toLowerCase()
  const deck = DECKS[deckName]

  if (!deck) {
    sendError(invocationId, 'INVALID_DECK', `Unknown deck: "${deckName}". Available: science, spanish.`)
    return
  }

  // Shuffle a copy of the deck
  currentDeckName = deckName
  questions = shuffleArray([...deck])
  currentIndex = 0
  results = []
  quizActive = true

  if (feedbackTimeout) {
    clearTimeout(feedbackTimeout)
    feedbackTimeout = null
  }

  renderCard()
  updateScoreCounter()
  showMessage('')
  resizeFrame()

  sendResult(invocationId, {
    deck: deckName,
    totalQuestions: questions.length,
    currentQuestion: 1,
    question: questions[0].question,
  })
}

function toolCheckAnswer(invocationId, params) {
  if (!quizActive) {
    sendError(invocationId, 'NO_QUIZ', 'No quiz in progress. Call start_quiz first.')
    return
  }
  if (currentIndex >= questions.length) {
    sendError(invocationId, 'QUIZ_COMPLETE', 'Quiz is already complete. Call get_score for results.')
    return
  }

  const studentAnswer = (params.answer || '').trim()
  if (!studentAnswer) {
    sendError(invocationId, 'EMPTY_ANSWER', 'Answer cannot be empty.')
    return
  }

  const current = questions[currentIndex]
  const correctAnswer = current.answer
  const isCorrect = checkMatch(studentAnswer, correctAnswer)

  results.push({
    question: current.question,
    studentAnswer,
    correctAnswer,
    isCorrect,
  })

  currentIndex++
  const quizComplete = currentIndex >= questions.length

  // Show feedback on card
  showFeedback(isCorrect, correctAnswer, quizComplete)
  updateScoreCounter()
  resizeFrame()

  const response = {
    correct: isCorrect,
    correctAnswer,
    questionsAnswered: results.length,
    totalQuestions: questions.length,
    quizComplete,
  }

  if (!quizComplete) {
    response.nextQuestion = questions[currentIndex].question
    response.currentQuestion = currentIndex + 1
  }

  sendResult(invocationId, response)
}

function toolGetScore() {
  return {
    questionsAnswered: results.length,
    correctCount: results.filter((r) => r.isCorrect).length,
    totalQuestions: questions.length,
    deck: currentDeckName,
    quizComplete: currentIndex >= questions.length,
    results: results.map((r) => ({
      question: r.question,
      studentAnswer: r.studentAnswer,
      correctAnswer: r.correctAnswer,
      isCorrect: r.isCorrect,
    })),
  }
}

// ---------------------------------------------------------------------------
// Answer Matching
// ---------------------------------------------------------------------------

function checkMatch(student, correct) {
  const s = student.toLowerCase().trim()
  const c = correct.toLowerCase().trim()

  // Exact match
  if (s === c) return true

  // Student answer contains the correct answer (e.g., "a cat" matches "cat")
  if (s.includes(c)) return true

  // Correct answer contains the student answer (e.g., "cat" matches for longer correct answers)
  // Only if student answer is at least 3 chars to avoid trivial matches
  if (s.length >= 3 && c.includes(s)) return true

  return false
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderCard() {
  const card = document.getElementById('card')
  card.className = ''

  if (!quizActive || currentIndex >= questions.length) {
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

function showFeedback(isCorrect, correctAnswer, quizComplete) {
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

  if (feedbackTimeout) clearTimeout(feedbackTimeout)

  feedbackTimeout = setTimeout(() => {
    feedbackTimeout = null
    if (quizComplete) {
      renderEndScreen()
    } else {
      renderCard()
    }
    resizeFrame()
  }, 1500)
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
  quizActive = false
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
  quizActive = false
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
