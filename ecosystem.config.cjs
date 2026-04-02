const { readFileSync } = require('fs')
const { resolve } = require('path')

// Load .env file if it exists (for secrets not committed to git)
function loadEnv() {
  try {
    const envFile = readFileSync(resolve(__dirname, '.env'), 'utf-8')
    const vars = {}
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const [key, ...rest] = trimmed.split('=')
      vars[key.trim()] = rest.join('=').trim()
    }
    return vars
  } catch {
    return {}
  }
}

const envFromFile = loadEnv()

module.exports = {
  apps: [
    {
      name: 'chatbridge-server',
      cwd: '/root/chatbridge',
      script: 'server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3100,
        ...envFromFile,
      },
    },
  ],
}
