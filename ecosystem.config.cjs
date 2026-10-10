/**
 * PM2 process definition for production.
 *
 * Configuration is not written here. It is read from the environment file below,
 * which lives outside the release and holds no secret itself: the token is in a
 * separate file that the environment file points to (MIDDLEWARE_TOKEN_FILE).
 *
 * Always start and restart through this file, so the new release directory and any
 * change to the environment file are picked up:
 *   pm2 startOrRestart /opt/missionzero-proxy/current/ecosystem.config.cjs --update-env
 */
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');

const ENV_FILE = process.env.MZ_ENV_FILE || '/etc/missionzero-proxy/env';

module.exports = {
  apps: [
    {
      name: 'missionzero-proxy',
      cwd: __dirname,
      script: 'dist/server.js',

      // One process, on purpose: the cache and the rate limiter live in its memory.
      exec_mode: 'fork',
      instances: 1,

      // Restart on any exit, with a delay that grows from 200 ms to 15 s while it keeps failing.
      autorestart: true,
      exp_backoff_restart_delay: 200,
      max_memory_restart: '400M',
      kill_timeout: 5000,

      // The application writes JSON lines that already carry a timestamp.
      merge_logs: true,

      env: {
        ...parseEnv(readFileSync(ENV_FILE, 'utf8')),
        // Fixed here so a mistake in the environment file cannot expose the port.
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
      },
    },
  ],
};
