// Chess App — State-machine next_turn pattern
// App is the state machine. LLM calls next_turn with context, app decides what happens.
// States: no_game → awaiting_move → (loop or game_over)

/* global Chess */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let game = null          // chess.js instance
let playerColor = 'w'    // 'w' or 'b'
let selectedSquare = null // currently selected square for click-to-move
let lastMove = null       // { from, to } for highlighting
let resigned = false      // chess.js has no resign concept, track separately
let appId = null
let sessionId = null

const PIECES = {
  K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658', P: '\u2659',
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F',
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

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
// Tool Handler — single next_turn entry point
// ---------------------------------------------------------------------------

function handleToolInvoke(msg) {
  const { invocationId, toolName, parameters } = msg

  if (toolName !== 'next_turn') {
    sendError(invocationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`)
    return
  }

  const input = parameters || {}

  try {
    if (!game) {
      // No game — need color to start, or return no_game state
      handleNoGame(invocationId, input)
    } else if (resigned || getGameStatus() !== 'in_progress') {
      // Game over — can start new game with color, or return result
      handleGameOver(invocationId, input)
    } else {
      // Game in progress — handle move, resign, or state query
      handleInProgress(invocationId, input)
    }
  } catch (err) {
    sendError(invocationId, 'EXECUTION_ERROR', err.message)
  }
}

// ---------------------------------------------------------------------------
// State: no_game
// ---------------------------------------------------------------------------

function handleNoGame(invocationId, input) {
  if (input.color) {
    // Start a new game
    const chosenColor = input.color === 'black' ? 'black' : 'white'
    playerColor = chosenColor === 'black' ? 'b' : 'w'
    resigned = false
    game = new Chess()
    selectedSquare = null
    lastMove = null
    renderBoard()
    updateStatus()
    resizeFrame()

    sendResult(invocationId, {
      state: 'awaiting_move',
      fen: game.fen(),
      gameStatus: 'in_progress',
      playerColor: chosenColor,
      turn: 'white',
      moveCount: 1,
    })
    return
  }

  sendResult(invocationId, {
    state: 'no_game',
    message: 'No game in progress. Provide a color to start a new game.',
  })
}

// ---------------------------------------------------------------------------
// State: game in progress
// ---------------------------------------------------------------------------

function handleInProgress(invocationId, input) {
  // Resign
  if (input.resign) {
    resigned = true
    const winner = game.turn() === 'w' ? 'black' : 'white'
    updateStatusText(`Game over: ${game.turn() === 'w' ? 'White' : 'Black'} resigned. ${winner} wins!`)

    sendResult(invocationId, {
      state: 'game_over',
      result: 'resigned',
      winner,
      fen: game.fen(),
    })
    return
  }

  // Make a move
  if (input.from && input.to) {
    const moveObj = { from: input.from, to: input.to }
    if (input.promotion) moveObj.promotion = input.promotion

    const move = game.move(moveObj)
    if (!move) {
      const legalFromSquare = game.moves({ square: input.from })
      sendError(invocationId, 'ILLEGAL_MOVE',
        `Illegal move: ${input.from} → ${input.to}. Legal moves from ${input.from}: ${legalFromSquare.join(', ') || 'none'}`)
      return
    }

    lastMove = { from: move.from, to: move.to }
    selectedSquare = null
    renderBoard()
    updateStatus()

    const status = getGameStatus()
    const result = {
      state: status === 'in_progress' ? 'awaiting_move' : 'game_over',
      fen: game.fen(),
      lastMove: `${move.from}${move.to}`,
      san: move.san,
      gameStatus: status,
      captured: move.captured || null,
      turn: game.turn() === 'w' ? 'white' : 'black',
      moveCount: Math.floor(game.history().length / 2) + 1,
    }

    if (status !== 'in_progress') {
      result.result = status
    }

    sendResult(invocationId, result)
    return
  }

  // No action — return current board state
  sendResult(invocationId, {
    state: 'awaiting_move',
    fen: game.fen(),
    turn: game.turn() === 'w' ? 'white' : 'black',
    moveCount: Math.floor(game.history().length / 2) + 1,
    gameStatus: 'in_progress',
    isCheck: game.in_check(),
    legalMoves: game.moves(),
  })
}

// ---------------------------------------------------------------------------
// State: game over
// ---------------------------------------------------------------------------

function handleGameOver(invocationId, input) {
  if (input.color) {
    // Start a new game
    handleNoGame(invocationId, input)
    return
  }

  sendResult(invocationId, {
    state: 'game_over',
    fen: game.fen(),
    result: getGameStatus(),
    moveCount: Math.floor(game.history().length / 2) + 1,
  })
}

// ---------------------------------------------------------------------------
// Game State
// ---------------------------------------------------------------------------

function getGameStatus() {
  if (game.in_checkmate()) return game.turn() === 'w' ? 'black_wins' : 'white_wins'
  if (game.in_draw()) return 'draw'
  if (game.in_stalemate()) return 'draw_stalemate'
  if (game.in_threefold_repetition()) return 'draw_repetition'
  if (game.insufficient_material()) return 'draw_insufficient'
  return 'in_progress'
}

function resetGame() {
  game = null
  selectedSquare = null
  lastMove = null
  resigned = false
  document.getElementById('board').innerHTML = ''
  updateStatusText('Waiting to start...')
  document.getElementById('turn-indicator').textContent = ''
  document.getElementById('move-history').textContent = ''
}

// ---------------------------------------------------------------------------
// Board Rendering
// ---------------------------------------------------------------------------

function renderBoard() {
  if (!game) return

  const board = document.getElementById('board')
  board.innerHTML = ''

  const ranks = playerColor === 'w' ? RANKS : [...RANKS].reverse()
  const files = playerColor === 'w' ? FILES : [...FILES].reverse()

  // Get legal move targets for selected square
  const legalTargets = new Set()
  if (selectedSquare) {
    const moves = game.moves({ square: selectedSquare, verbose: true })
    for (const m of moves) {
      legalTargets.add(m.to)
    }
  }

  // Find king in check
  let checkSquare = null
  if (game.in_check()) {
    const board8x8 = game.board()
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board8x8[r][f]
        if (piece && piece.type === 'k' && piece.color === game.turn()) {
          checkSquare = FILES[f] + RANKS[r]
        }
      }
    }
  }

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = files[f]
      const rank = ranks[r]
      const square = file + rank
      const isLight = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0

      const el = document.createElement('div')
      el.className = 'square ' + (isLight ? 'light' : 'dark')
      el.dataset.square = square

      // Highlight
      if (square === selectedSquare) el.classList.add('selected')
      if (lastMove && (square === lastMove.from || square === lastMove.to)) el.classList.add('last-move')
      if (square === checkSquare) el.classList.add('check')

      // Legal move indicator
      if (legalTargets.has(square)) {
        el.classList.add('legal-target')
        const piece = game.get(square)
        if (piece) el.classList.add('has-piece')
      }

      // Piece
      const piece = game.get(square)
      if (piece) {
        const key = piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()
        el.textContent = PIECES[key] || ''
      }

      el.addEventListener('click', () => onSquareClick(square))
      board.appendChild(el)
    }
  }
}

// ---------------------------------------------------------------------------
// User Interaction (click-to-move)
// ---------------------------------------------------------------------------

function onSquareClick(square) {
  if (!game || getGameStatus() !== 'in_progress') return

  // Only allow moves on player's turn
  if (game.turn() !== playerColor) return

  if (selectedSquare) {
    // Try to make a move
    const moveObj = { from: selectedSquare, to: square }

    // Check for promotion
    const piece = game.get(selectedSquare)
    if (piece && piece.type === 'p') {
      const targetRank = square[1]
      if ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1')) {
        moveObj.promotion = 'q' // Auto-promote to queen
      }
    }

    const move = game.move(moveObj)
    if (move) {
      lastMove = { from: move.from, to: move.to }
      selectedSquare = null
      renderBoard()
      updateStatus()
      return
    }

    // Invalid move — deselect and maybe select new square
    selectedSquare = null
  }

  // Select a piece
  const piece = game.get(square)
  if (piece && piece.color === playerColor) {
    selectedSquare = square
  } else {
    selectedSquare = null
  }

  renderBoard()
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function updateStatus() {
  const status = getGameStatus()
  const turn = game.turn() === 'w' ? 'White' : 'Black'
  const check = game.in_check() ? ' (Check!)' : ''

  switch (status) {
    case 'in_progress':
      updateStatusText(`${turn}'s turn${check}`)
      break
    case 'white_wins':
      updateStatusText('Checkmate! White wins.')
      break
    case 'black_wins':
      updateStatusText('Checkmate! Black wins.')
      break
    case 'draw':
    case 'draw_stalemate':
    case 'draw_repetition':
    case 'draw_insufficient':
      updateStatusText('Game over: Draw')
      break
  }

  document.getElementById('turn-indicator').textContent =
    `Move ${Math.ceil(game.history().length / 2 + 1)}`

  // Update move history
  const history = game.history()
  const historyEl = document.getElementById('move-history')
  const pairs = []
  for (let i = 0; i < history.length; i += 2) {
    const num = Math.floor(i / 2) + 1
    pairs.push(`${num}. ${history[i]}${history[i + 1] ? ' ' + history[i + 1] : ''}`)
  }
  historyEl.textContent = pairs.join('  ')
  historyEl.scrollTop = historyEl.scrollHeight
}

function updateStatusText(text) {
  document.getElementById('status').textContent = text
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setTimeout(() => {
  if (!appId) {
    updateStatusText('Chess app loaded. Awaiting bridge connection...')
  }
}, 1000)
