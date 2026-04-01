// Chess App — ChatBridge Bridge Protocol Implementation
// Uses chess.js for game logic, pure CSS/Unicode for board rendering.

/* global Chess */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let game = null          // chess.js instance
let playerColor = 'w'    // 'w' or 'b'
let selectedSquare = null // currently selected square for click-to-move
let lastMove = null       // { from, to } for highlighting
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
// Tool Handlers
// ---------------------------------------------------------------------------

function handleToolInvoke(msg) {
  const { invocationId, toolName, parameters } = msg

  try {
    let result
    switch (toolName) {
      case 'start_game':
        result = toolStartGame(parameters)
        break
      case 'move_piece':
        result = toolMovePiece(parameters)
        break
      case 'get_board_state':
        result = toolGetBoardState()
        break
      case 'get_legal_moves':
        result = toolGetLegalMoves(parameters)
        break
      case 'resign':
        result = toolResign()
        break
      default:
        sendError(invocationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`)
        return
    }
    sendResult(invocationId, result)
  } catch (err) {
    sendError(invocationId, 'EXECUTION_ERROR', err.message)
  }
}

function toolStartGame(params) {
  const color = params.color || 'white'
  playerColor = color === 'black' ? 'b' : 'w'
  game = new Chess()
  selectedSquare = null
  lastMove = null
  renderBoard()
  updateStatus()
  resizeFrame()

  return {
    fen: game.fen(),
    gameStatus: 'in_progress',
    playerColor: color,
    turn: 'white',
  }
}

function toolMovePiece(params) {
  if (!game) throw new Error('No game in progress. Call start_game first.')

  const moveObj = { from: params.from, to: params.to }
  if (params.promotion) moveObj.promotion = params.promotion

  const move = game.move(moveObj)
  if (!move) {
    throw new Error(`Illegal move: ${params.from} -> ${params.to}. Legal moves from ${params.from}: ${game.moves({ square: params.from }).join(', ') || 'none'}`)
  }

  lastMove = { from: move.from, to: move.to }
  selectedSquare = null
  renderBoard()
  updateStatus()

  return {
    fen: game.fen(),
    lastMove: `${move.from}${move.to}`,
    san: move.san,
    gameStatus: getGameStatus(),
    captured: move.captured || null,
    turn: game.turn() === 'w' ? 'white' : 'black',
  }
}

function toolGetBoardState() {
  if (!game) throw new Error('No game in progress. Call start_game first.')

  return {
    fen: game.fen(),
    turn: game.turn() === 'w' ? 'white' : 'black',
    moveCount: Math.ceil(game.moveNumber()),
    gameStatus: getGameStatus(),
    isCheck: game.isCheck(),
    legalMoves: game.moves(),
  }
}

function toolGetLegalMoves(params) {
  if (!game) throw new Error('No game in progress. Call start_game first.')

  const opts = params.square ? { square: params.square } : {}
  return {
    moves: game.moves(opts),
    square: params.square || 'all',
  }
}

function toolResign() {
  if (!game) throw new Error('No game in progress.')

  const winner = game.turn() === 'w' ? 'black' : 'white'
  updateStatusText(`Game over: ${game.turn() === 'w' ? 'White' : 'Black'} resigned. ${winner} wins!`)

  return {
    result: 'resigned',
    winner,
    fen: game.fen(),
  }
}

// ---------------------------------------------------------------------------
// Game State
// ---------------------------------------------------------------------------

function getGameStatus() {
  if (game.isCheckmate()) return game.turn() === 'w' ? 'black_wins' : 'white_wins'
  if (game.isDraw()) return 'draw'
  if (game.isStalemate()) return 'draw_stalemate'
  if (game.isThreefoldRepetition()) return 'draw_repetition'
  if (game.isInsufficientMaterial()) return 'draw_insufficient'
  return 'in_progress'
}

function resetGame() {
  game = null
  selectedSquare = null
  lastMove = null
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
  if (game.isCheck()) {
    // Find the king of the current turn
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

      // Notify the platform that the user made a move (for LLM awareness)
      // This is informational — the LLM can query get_board_state to see changes
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
  const check = game.isCheck() ? ' (Check!)' : ''

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
    `Move ${Math.ceil(game.moveNumber())}`

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
// Init — send ready immediately if no bridge:init needed
// (bridge:init will come from AppHost, but be ready for direct loading too)
// ---------------------------------------------------------------------------

// If loaded outside of bridge context (e.g. direct browser), show a message
setTimeout(() => {
  if (!appId) {
    updateStatusText('Chess app loaded. Awaiting bridge connection...')
  }
}, 1000)
