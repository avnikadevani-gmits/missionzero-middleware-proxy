import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const live = { MIDDLEWARE_MODE: 'live', MIDDLEWARE_TOKEN: 'abc.def-123' };

describe('configuration', () => {
  it('has safe defaults', () => {
    const c = loadConfig(live);
    expect(c).toMatchObject({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3100,
      mode: 'live',
      allowedOrigins: ['https://missionzero.gr'],
      cacheTtlMs: 15000,
    });
  });

  it('requires a token in live mode, which is the default mode', () => {
    expect(() => loadConfig({})).toThrow(/MIDDLEWARE_TOKEN/);
    expect(() => loadConfig({ MIDDLEWARE_MODE: 'live', MIDDLEWARE_TOKEN: '   ' })).toThrow(ConfigError);
  });

  it('refuses a malformed token without echoing it', () => {
    const attempt = () => loadConfig({ MIDDLEWARE_TOKEN: 'two words' });
    expect(attempt).toThrow(/malformed/);
    expect(attempt).not.toThrow(/two words/);
  });

  it('reads the token from a file, and refuses both sources at once', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mz-')), 'token');
    writeFileSync(file, 'file-token\n');
    expect(loadConfig({ MIDDLEWARE_TOKEN_FILE: file }).middlewareToken).toBe('file-token');
    expect(() => loadConfig({ ...live, MIDDLEWARE_TOKEN_FILE: file })).toThrow(/not both/);
    expect(() => loadConfig({ MIDDLEWARE_TOKEN_FILE: `${file}-missing` })).toThrow(/could not be read/);
  });

  it('needs no token in mock mode', () => {
    expect(loadConfig({ MIDDLEWARE_MODE: 'mock' })).toMatchObject({ mode: 'mock', middlewareToken: null });
  });

  it('refuses mock mode in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', MIDDLEWARE_MODE: 'mock' })).toThrow(/not allowed/);
    expect(() => loadConfig({ ...live, NODE_ENV: 'production', MIDDLEWARE_MODE: 'mock' })).toThrow(/not allowed/);
  });

  it('never falls back to mock when production has no token', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/MIDDLEWARE_TOKEN/);
  });

  it('refuses disabled TLS verification', () => {
    expect(() => loadConfig({ ...live, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toThrow(/NODE_EXTRA_CA_CERTS/);
  });

  it('keeps production on loopback and on https origins', () => {
    const prod = { ...live, NODE_ENV: 'production' };
    expect(() => loadConfig({ ...prod, HOST: '0.0.0.0' })).toThrow(/loopback/);
    expect(() => loadConfig({ ...prod, CORS_ALLOWED_ORIGINS: 'http://missionzero.gr' })).toThrow(/https/);
    expect(loadConfig(prod).host).toBe('127.0.0.1');
  });

  it('validates origins and numbers', () => {
    expect(() => loadConfig({ ...live, CORS_ALLOWED_ORIGINS: '*' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...live, CORS_ALLOWED_ORIGINS: 'https://missionzero.gr/app' })).toThrow(/no path/);
    expect(() => loadConfig({ ...live, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...live, MIDDLEWARE_MODE: 'auto' })).toThrow(/MIDDLEWARE_MODE/);
    expect(
      loadConfig({ ...live, CORS_ALLOWED_ORIGINS: 'https://missionzero.gr, http://localhost:8080' }).allowedOrigins,
    ).toEqual(['https://missionzero.gr', 'http://localhost:8080']);
  });
});
