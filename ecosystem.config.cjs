require('dotenv').config();

module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || 'openGym',
      script: 'dist/server.cjs',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};