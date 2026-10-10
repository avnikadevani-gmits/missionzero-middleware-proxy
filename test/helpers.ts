import { readFileSync } from 'node:fs';
import type { Config } from '../src/config.js';
import { OPERATIONS_URL, PROCESS_URL } from '../src/upstream.js';

export type Raw = Record<string, any>;

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export const LATEST = 'sc4-1791154762922';
export const OLDER = 'sc4-1791154668076';
export const opId = (run: string, material: string) => `ManufacturingMachineOperation:${run}-${material}`;

/** Fresh copies every call, so a test can edit them freely. */
export const processFixture = (): Raw => structuredClone(read('process.json')) as Raw;
export const operationsFixture = (): Raw[] => structuredClone(read('operations.json')) as Raw[];

export const findOp = (ops: Raw[], run: string, material: string): Raw => {
  const found = ops.find((o) => o.entityId === opId(run, material));
  if (!found) throw new Error(`fixture has no ${run}-${material}`);
  return found;
};

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  mode: 'live',
  middlewareToken: 'test-token-do-not-leak',
  allowedOrigins: ['https://missionzero.gr'],
  cacheTtlMs: 15000,
  staleMaxMs: 600000,
  upstreamTimeoutMs: 8000,
  upstreamMaxBytes: 5 * 1024 * 1024,
  rateLimitPerMinute: 300,
  ...overrides,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** A fetch that answers the two allowed URLs and records every call it receives. */
export function fakeMiddleware(process: unknown = processFixture(), operations: unknown = operationsFixture()) {
  const calls: { url: string; init: RequestInit }[] = [];
  const state = { process, operations };
  const fetchImpl = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === PROCESS_URL) return json(state.process);
    if (url === OPERATIONS_URL) return json(state.operations);
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls, state };
}
