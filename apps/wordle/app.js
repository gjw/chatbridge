// Wordle App — ChatBridge Bridge Protocol Implementation
// Uses Free Dictionary API (proxied through platform) for word validation.

/* global TARGET_WORDS */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let targetWord = ''
let guesses = []          // Array of {word, result: [{letter, status}]}
let currentGuess = ''
let gameOver = false
let won = false
let hardMode = false
let appId = null
let sessionId = null
let pendingApiRequests = new Map()  // requestId → {resolve, reject}

const MAX_GUESSES = 6
const WORD_LENGTH = 5
const KEYBOARD_ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['Enter','z','x','c','v','b','n','m','Backspace'],
]

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

    case 'bridge:api:response':
      handleApiResponse(msg)
      break

    case 'bridge:destroy':
      resetGame()
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
// API Proxy (bridge:api:request / bridge:api:response)
// ---------------------------------------------------------------------------

function apiRequest(url, method) {
  return new Promise((resolve, reject) => {
    const requestId = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    pendingApiRequests.set(requestId, { resolve, reject })

    window.parent.postMessage({
      type: 'bridge:api:request',
      requestId,
      url,
      method: method || 'GET',
    }, '*')

    // Timeout after 10s
    setTimeout(() => {
      if (pendingApiRequests.has(requestId)) {
        pendingApiRequests.delete(requestId)
        reject(new Error('API request timed out'))
      }
    }, 10000)
  })
}

function handleApiResponse(msg) {
  const pending = pendingApiRequests.get(msg.requestId)
  if (!pending) return
  pendingApiRequests.delete(msg.requestId)
  pending.resolve({ status: msg.status, body: msg.body })
}

// ---------------------------------------------------------------------------
// Dictionary Validation
// ---------------------------------------------------------------------------

async function isValidWord(word) {
  try {
    const response = await apiRequest(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`,
      'GET',
    )
    return response.status === 200
  } catch {
    // If API is unavailable, accept the word (graceful degradation)
    console.warn('[wordle] Dictionary API unavailable, accepting word')
    return true
  }
}

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

function handleToolInvoke(msg) {
  const { invocationId, toolName, parameters } = msg

  switch (toolName) {
    case 'start_game':
      toolStartGame(invocationId, parameters)
      break
    case 'guess_word':
      toolGuessWord(invocationId, parameters)
      break
    case 'get_status':
      sendResult(invocationId, toolGetStatus())
      break
    default:
      sendError(invocationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`)
  }
}

function toolStartGame(invocationId, params) {
  // If a game is already in progress, return current state instead of restarting
  if (targetWord && !gameOver) {
    sendResult(invocationId, {
      alreadyActive: true,
      guessNumber: guesses.length + 1,
      maxGuesses: MAX_GUESSES,
      wordLength: WORD_LENGTH,
      hardMode,
    })
    return
  }

  hardMode = params.hardMode || false
  targetWord = TARGET_WORDS[Math.floor(Math.random() * TARGET_WORDS.length)].toLowerCase()
  guesses = []
  currentGuess = ''
  gameOver = false
  won = false

  renderBoard()
  renderKeyboard()
  updateStatus('Game started! Guess a 5-letter word.')
  showMessage('')
  resizeFrame()

  sendResult(invocationId, {
    gameId: Date.now().toString(36),
    maxGuesses: MAX_GUESSES,
    wordLength: WORD_LENGTH,
    hardMode,
  })
}

async function toolGuessWord(invocationId, params) {
  if (!targetWord) {
    sendError(invocationId, 'NO_GAME', 'No game in progress. Call start_game first.')
    return
  }
  if (gameOver) {
    sendError(invocationId, 'GAME_OVER', 'Game is already over.')
    return
  }

  const word = (params.word || '').toLowerCase().trim()
  if (word.length !== WORD_LENGTH) {
    sendError(invocationId, 'INVALID_LENGTH', `Word must be exactly ${WORD_LENGTH} letters.`)
    return
  }
  if (!/^[a-z]+$/.test(word)) {
    sendError(invocationId, 'INVALID_CHARS', 'Word must contain only letters.')
    return
  }

  // Validate against dictionary API
  showMessage('Checking word...')
  const valid = await isValidWord(word)
  if (!valid) {
    showMessage('Not a valid word!', 'error')
    sendResult(invocationId, {
      valid: false,
      message: `"${word}" is not a valid English word.`,
      guessNumber: guesses.length,
      gameOver: false,
      won: false,
    })
    return
  }

  // Score the guess
  const result = scoreGuess(word, targetWord)
  guesses.push({ word, result })

  won = word === targetWord
  gameOver = won || guesses.length >= MAX_GUESSES

  // Update UI
  currentGuess = ''
  renderBoard()
  renderKeyboard()

  if (won) {
    showMessage(`You got it in ${guesses.length}!`, 'success')
    updateStatus('You won!')
  } else if (gameOver) {
    showMessage(`Game over! The word was "${targetWord.toUpperCase()}".`, 'error')
    updateStatus('Game over')
  } else {
    showMessage('')
    updateStatus(`Guess ${guesses.length}/${MAX_GUESSES}`)
  }

  resizeFrame()

  sendResult(invocationId, {
    valid: true,
    result: result.map((r) => ({ letter: r.letter, status: r.status })),
    guessNumber: guesses.length,
    maxGuesses: MAX_GUESSES,
    gameOver,
    won,
    ...(gameOver && !won ? { answer: targetWord } : {}),
  })
}

function toolGetStatus() {
  return {
    inProgress: !!targetWord && !gameOver,
    guessNumber: guesses.length,
    maxGuesses: MAX_GUESSES,
    guesses: guesses.map((g) => ({
      word: g.word,
      result: g.result.map((r) => ({ letter: r.letter, status: r.status })),
    })),
    gameOver,
    won,
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreGuess(guess, target) {
  const result = []
  const targetArr = target.split('')
  const guessArr = guess.split('')
  const used = new Array(WORD_LENGTH).fill(false)

  // First pass: correct positions (green)
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guessArr[i] === targetArr[i]) {
      result[i] = { letter: guessArr[i], status: 'correct' }
      used[i] = true
    }
  }

  // Second pass: present but wrong position (yellow) or absent (gray)
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i]) continue

    let found = false
    for (let j = 0; j < WORD_LENGTH; j++) {
      if (!used[j] && guessArr[i] === targetArr[j]) {
        result[i] = { letter: guessArr[i], status: 'present' }
        used[j] = true
        found = true
        break
      }
    }
    if (!found) {
      result[i] = { letter: guessArr[i], status: 'absent' }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Board Rendering
// ---------------------------------------------------------------------------

function renderBoard() {
  const board = document.getElementById('board')
  board.innerHTML = ''

  for (let row = 0; row < MAX_GUESSES; row++) {
    const rowEl = document.createElement('div')
    rowEl.className = 'row'

    for (let col = 0; col < WORD_LENGTH; col++) {
      const tile = document.createElement('div')
      tile.className = 'tile'

      if (row < guesses.length) {
        // Completed guess
        const g = guesses[row]
        tile.textContent = g.result[col].letter
        tile.classList.add(g.result[col].status)
      } else if (row === guesses.length && col < currentGuess.length) {
        // Current input
        tile.textContent = currentGuess[col]
        tile.classList.add('filled')
      }

      rowEl.appendChild(tile)
    }

    board.appendChild(rowEl)
  }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const letterStatus = {}  // letter → best status

function renderKeyboard() {
  // Update letter statuses from all guesses
  for (const g of guesses) {
    for (const r of g.result) {
      const current = letterStatus[r.letter]
      if (r.status === 'correct') {
        letterStatus[r.letter] = 'correct'
      } else if (r.status === 'present' && current !== 'correct') {
        letterStatus[r.letter] = 'present'
      } else if (r.status === 'absent' && !current) {
        letterStatus[r.letter] = 'absent'
      }
    }
  }

  const kb = document.getElementById('keyboard')
  kb.innerHTML = ''

  for (const row of KEYBOARD_ROWS) {
    const rowEl = document.createElement('div')
    rowEl.className = 'kb-row'

    for (const key of row) {
      const btn = document.createElement('button')
      btn.className = 'key'
      btn.textContent = key === 'Backspace' ? '⌫' : key

      if (key === 'Enter' || key === 'Backspace') {
        btn.classList.add('wide')
      }

      const status = letterStatus[key.toLowerCase()]
      if (status) btn.classList.add(status)

      btn.addEventListener('click', () => onKeyPress(key))
      rowEl.appendChild(btn)
    }

    kb.appendChild(rowEl)
  }
}

// ---------------------------------------------------------------------------
// User Input (keyboard)
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'Enter') onKeyPress('Enter')
  else if (e.key === 'Backspace') onKeyPress('Backspace')
  else if (/^[a-zA-Z]$/.test(e.key)) onKeyPress(e.key.toLowerCase())
})

function onKeyPress(key) {
  if (!targetWord || gameOver) return

  if (key === 'Backspace') {
    currentGuess = currentGuess.slice(0, -1)
    renderBoard()
    return
  }

  if (key === 'Enter') {
    if (currentGuess.length !== WORD_LENGTH) {
      showMessage('Not enough letters', 'error')
      return
    }
    // Submit via tool invoke — but if user types directly, we handle locally
    submitUserGuess(currentGuess)
    return
  }

  if (currentGuess.length < WORD_LENGTH && /^[a-z]$/.test(key)) {
    currentGuess += key
    renderBoard()
  }
}

async function submitUserGuess(word) {
  showMessage('Checking word...')
  const valid = await isValidWord(word)
  if (!valid) {
    showMessage('Not a valid word!', 'error')
    return
  }

  const result = scoreGuess(word, targetWord)
  guesses.push({ word, result })

  won = word === targetWord
  gameOver = won || guesses.length >= MAX_GUESSES

  currentGuess = ''
  renderBoard()
  renderKeyboard()

  if (won) {
    showMessage(`You got it in ${guesses.length}!`, 'success')
    updateStatus('You won!')
  } else if (gameOver) {
    showMessage(`Game over! The word was "${targetWord.toUpperCase()}".`, 'error')
    updateStatus('Game over')
  } else {
    showMessage('')
    updateStatus(`Guess ${guesses.length}/${MAX_GUESSES}`)
  }

  resizeFrame()
}

// ---------------------------------------------------------------------------
// UI Helpers
// ---------------------------------------------------------------------------

function updateStatus(text) {
  document.getElementById('status').textContent = text
}

function showMessage(text, type) {
  const el = document.getElementById('message')
  el.textContent = text
  el.className = type || ''
}

function resetGame() {
  targetWord = ''
  guesses = []
  currentGuess = ''
  gameOver = false
  won = false
  Object.keys(letterStatus).forEach((k) => delete letterStatus[k])
  document.getElementById('board').innerHTML = ''
  document.getElementById('keyboard').innerHTML = ''
  updateStatus('Waiting to start...')
  showMessage('')
}

// Init
setTimeout(() => {
  if (!appId) {
    updateStatus('Wordle app loaded. Awaiting bridge connection...')
  }
}, 1000)
