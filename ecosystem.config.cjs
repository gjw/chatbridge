module.exports = {
  apps: [
    {
      name: 'chatbridge-server',
      script: 'server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3100,
      },
    },
  ],
}
