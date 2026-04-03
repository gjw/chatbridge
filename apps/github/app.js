// GitHub Profile Viewer — ChatBridge App (external_auth tier)
// Demonstrates OAuth2 flow with server-side token custody.

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let appId = null
let sessionId = null

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
    case 'authorize_github':
      toolAuthorizeGitHub(invocationId)
      break
    case 'get_profile':
      toolGetProfile(invocationId)
      break
    case 'list_repos':
      toolListRepos(invocationId, parameters)
      break
    default:
      sendError(invocationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`)
  }
}

// ---------------------------------------------------------------------------
// Bridge helpers
// ---------------------------------------------------------------------------

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
    height: Math.min(Math.max(height, 100), 800),
  }, '*')
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
      type: 'bridge:api:request',
      requestId,
      url,
      method: method || 'GET',
      headers: headers || {},
      body: body || undefined,
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
// Tool: authorize_github
// ---------------------------------------------------------------------------

let pendingOAuthInvocation = null

function handleOAuthComplete(msg) {
  if (!pendingOAuthInvocation) return
  const invocationId = pendingOAuthInvocation
  pendingOAuthInvocation = null

  // Popup closed — check if auth succeeded
  const statusEl = document.getElementById('status')
  checkAuthStatus().then((authorized) => {
    if (authorized) {
      statusEl.textContent = 'GitHub connected!'
      resizeFrame()
      sendResult(invocationId, { authorized: true, message: 'Successfully connected to GitHub' })
    } else {
      statusEl.textContent = 'Authorization was not completed.'
      resizeFrame()
      sendResult(invocationId, { authorized: false, message: 'User did not complete authorization' })
    }
  }).catch(() => {
    statusEl.textContent = 'Failed to check authorization status.'
    resizeFrame()
    sendError(invocationId, 'AUTH_CHECK_FAILED', 'Could not verify authorization status')
  })
}

async function checkAuthStatus() {
  const serverOrigin = window.location.origin.replace(/:\d+$/, ':3100')
  const resp = await apiRequest(serverOrigin + '/api/oauth/github/status', 'GET')
  return resp.body && resp.body.authorized
}

async function toolAuthorizeGitHub(invocationId) {
  const statusEl = document.getElementById('status')

  // First check if already authorized
  try {
    const authorized = await checkAuthStatus()
    if (authorized) {
      statusEl.textContent = 'GitHub connected!'
      resizeFrame()
      sendResult(invocationId, { authorized: true, message: 'Already connected to GitHub' })
      return
    }
  } catch {
    // Status check failed — proceed to auth flow
  }

  // Show connect button
  statusEl.innerHTML = '<button class="connect-btn" id="connect-btn">Connect GitHub</button><p style="margin-top:8px;color:#57606a;font-size:13px;">Click to authorize with GitHub</p>'
  resizeFrame()

  const btn = document.getElementById('connect-btn')
  btn.addEventListener('click', () => {
    btn.disabled = true
    btn.textContent = 'Connecting...'

    // Ask parent to open OAuth popup (parent has the auth token)
    pendingOAuthInvocation = invocationId
    window.parent.postMessage({
      type: 'bridge:oauth:request',
      requestId: 'oauth-' + Math.random().toString(36).slice(2),
    }, '*')
  })
}

// ---------------------------------------------------------------------------
// Tool: get_profile
// ---------------------------------------------------------------------------

async function toolGetProfile(invocationId) {
  const profileEl = document.getElementById('profile')
  const statusEl = document.getElementById('status')

  statusEl.textContent = 'Loading profile...'
  statusEl.classList.remove('hidden')
  profileEl.classList.add('hidden')
  resizeFrame()

  try {
    const resp = await apiRequest('https://api.github.com/user', 'GET', {
      Accept: 'application/vnd.github.v3+json',
    })

    if (resp.status === 401) {
      statusEl.textContent = 'Not authorized. Please connect GitHub first.'
      resizeFrame()
      sendResult(invocationId, { error: 'Not authorized. Call authorize_github first.' })
      return
    }

    const user = resp.body

    profileEl.innerHTML = `
      <div class="profile-card">
        <img class="profile-avatar" src="${escapeHtml(user.avatar_url)}" alt="Avatar">
        <div class="profile-info">
          <h2>${escapeHtml(user.name || user.login)}</h2>
          <div class="username">@${escapeHtml(user.login)}</div>
          ${user.bio ? `<div class="bio">${escapeHtml(user.bio)}</div>` : ''}
          <div class="profile-stats">
            <span><strong>${user.public_repos}</strong> repos</span>
            <span><strong>${user.followers}</strong> followers</span>
            <span><strong>${user.following}</strong> following</span>
          </div>
        </div>
      </div>
    `

    statusEl.classList.add('hidden')
    profileEl.classList.remove('hidden')
    resizeFrame()

    sendResult(invocationId, {
      login: user.login,
      name: user.name,
      bio: user.bio,
      public_repos: user.public_repos,
      followers: user.followers,
      following: user.following,
    })
  } catch (err) {
    statusEl.textContent = 'Failed to load profile.'
    resizeFrame()
    sendError(invocationId, 'PROFILE_FETCH_FAILED', err.message)
  }
}

// ---------------------------------------------------------------------------
// Tool: list_repos
// ---------------------------------------------------------------------------

async function toolListRepos(invocationId, params) {
  const reposEl = document.getElementById('repos')
  const statusEl = document.getElementById('status')
  const limit = Math.min(Math.max(params.limit || 10, 1), 30)

  statusEl.textContent = 'Loading repositories...'
  statusEl.classList.remove('hidden')
  reposEl.classList.add('hidden')
  resizeFrame()

  try {
    const resp = await apiRequest(
      `https://api.github.com/user/repos?sort=updated&per_page=${limit}`,
      'GET',
      { Accept: 'application/vnd.github.v3+json' },
    )

    if (resp.status === 401) {
      statusEl.textContent = 'Not authorized. Please connect GitHub first.'
      resizeFrame()
      sendResult(invocationId, { error: 'Not authorized. Call authorize_github first.' })
      return
    }

    const repos = resp.body

    if (!Array.isArray(repos) || repos.length === 0) {
      statusEl.textContent = 'No repositories found.'
      resizeFrame()
      sendResult(invocationId, { repos: [], count: 0 })
      return
    }

    reposEl.innerHTML = `
      <div class="repo-list">
        ${repos.map((repo) => `
          <div class="repo-card">
            <div class="repo-name">${escapeHtml(repo.name)}</div>
            ${repo.description ? `<div class="repo-desc">${escapeHtml(repo.description)}</div>` : ''}
            <div class="repo-meta">
              ${repo.language ? `<span><span class="language-dot" style="background:${languageColor(repo.language)}"></span>${escapeHtml(repo.language)}</span>` : ''}
              ${repo.stargazers_count > 0 ? `<span>\u2B50 ${repo.stargazers_count}</span>` : ''}
              ${repo.fork ? '<span>Fork</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `

    statusEl.classList.add('hidden')
    reposEl.classList.remove('hidden')
    resizeFrame()

    sendResult(invocationId, {
      repos: repos.map((r) => ({
        name: r.name,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        fork: r.fork,
        updated_at: r.updated_at,
      })),
      count: repos.length,
    })
  } catch (err) {
    statusEl.textContent = 'Failed to load repositories.'
    resizeFrame()
    sendError(invocationId, 'REPOS_FETCH_FAILED', err.message)
  }
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

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  PHP: '#4F5D95',
}

function languageColor(lang) {
  return LANGUAGE_COLORS[lang] || '#8b949e'
}

function resetApp() {
  document.getElementById('status').textContent = 'Waiting to connect...'
  document.getElementById('status').classList.remove('hidden')
  document.getElementById('profile').classList.add('hidden')
  document.getElementById('profile').innerHTML = ''
  document.getElementById('repos').classList.add('hidden')
  document.getElementById('repos').innerHTML = ''
}
