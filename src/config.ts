import { readFileSync } from 'node:fs';

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: string;
  mode: 'live' | 'mock';
  /** Null only in mock mode. */
  middlewareToken: string | null;
  allowedOrigins: string[];
  cacheTtlMs: number;
  staleMaxMs: number;
  upstreamTimeoutMs: number;
  upstreamMaxBytes: number;
  rateLimitPerMinute: number;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const raw = env[name]?.trim() || fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ConfigError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return raw as T;
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function readToken(env: Env): string {
  const inline = env.MIDDLEWARE_TOKEN?.trim();
  const file = env.MIDDLEWARE_TOKEN_FILE?.trim();
  if (inline && file) throw new ConfigError('Set MIDDLEWARE_TOKEN or MIDDLEWARE_TOKEN_FILE, not both');
  if (!inline && !file) {
    throw new ConfigError('MIDDLEWARE_TOKEN or MIDDLEWARE_TOKEN_FILE is required when MIDDLEWARE_MODE=live');
  }
  let token = inline ?? '';
  if (file) {
    try {
      token = readFileSync(file, 'utf8').trim();
    } catch {
      throw new ConfigError('MIDDLEWARE_TOKEN_FILE could not be read');
    }
  }
  // A token is one printable word. Anything else would corrupt the Authorization header.
  if (!/^[\x21-\x7e]+$/.test(token)) throw new ConfigError('The middleware token is empty or malformed');
  return token;
}

function readOrigins(env: Env, production: boolean): string[] {
  const origins = (env.CORS_ALLOWED_ORIGINS ?? 'https://missionzero.gr')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) throw new ConfigError('CORS_ALLOWED_ORIGINS is empty');
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new ConfigError(`CORS_ALLOWED_ORIGINS: "${origin}" is not an origin`);
    }
    if (url.origin !== origin) {
      throw new ConfigError(`CORS_ALLOWED_ORIGINS: "${origin}" must be scheme://host[:port] with no path`);
    }
    if (production && url.protocol !== 'https:') {
      throw new ConfigError(`CORS_ALLOWED_ORIGINS: "${origin}" must be https in production`);
    }
  }
  return origins;
}

/** Reads and validates the whole configuration. Throws ConfigError; never prints a secret. */
export function loadConfig(env: Env = process.env): Config {
  const nodeEnv = oneOf(env, 'NODE_ENV', ['development', 'production', 'test'] as const, 'development');
  const production = nodeEnv === 'production';
  const mode = oneOf(env, 'MIDDLEWARE_MODE', ['live', 'mock'] as const, 'live');

  if (production && mode === 'mock') {
    throw new ConfigError('MIDDLEWARE_MODE=mock is not allowed when NODE_ENV=production');
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new ConfigError(
      'NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate checks and is refused. Use NODE_EXTRA_CA_CERTS to trust a private CA.',
    );
  }

  const host = env.HOST?.trim() || '127.0.0.1';
  if (production && !LOOPBACK.includes(host)) {
    throw new ConfigError('HOST must be a loopback address in production; Nginx is the public listener');
  }

  return {
    nodeEnv,
    host,
    port: int(env, 'PORT', 3100, 1, 65535),
    logLevel: oneOf(env, 'LOG_LEVEL', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const, 'info'),
    mode,
    middlewareToken: mode === 'live' ? readToken(env) : null,
    allowedOrigins: readOrigins(env, production),
    cacheTtlMs: int(env, 'CACHE_TTL_SECONDS', 15, 1, 3600) * 1000,
    staleMaxMs: int(env, 'CACHE_STALE_MAX_SECONDS', 600, 0, 86400) * 1000,
    upstreamTimeoutMs: int(env, 'UPSTREAM_TIMEOUT_MS', 8000, 500, 60000),
    upstreamMaxBytes: int(env, 'UPSTREAM_MAX_BYTES', 5 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    rateLimitPerMinute: int(env, 'RATE_LIMIT_PER_MINUTE', 300, 1, 100000),
  };
}
