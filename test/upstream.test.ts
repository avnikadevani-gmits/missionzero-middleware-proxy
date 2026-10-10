import { describe, expect, it } from 'vitest';
import { createFixtureFetch, createUpstreamClient, OPERATIONS_URL, PROCESS_URL, UpstreamError } from '../src/upstream.js';
import { fakeMiddleware } from './helpers.js';

const client = (fetchImpl: typeof fetch, extra: { timeoutMs?: number; maxBytes?: number } = {}) =>
  createUpstreamClient({ token: 'tok-123', timeoutMs: 8000, maxBytes: 1024 * 1024, fetchImpl, ...extra });

const failure = async (p: Promise<unknown>): Promise<UpstreamError> => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(UpstreamError);
  return error as UpstreamError;
};

describe('upstream client', () => {
  it('calls exactly the two allowed URLs', async () => {
    const mw = fakeMiddleware();
    const c = client(mw.fetchImpl);
    await c.fetchProcess();
    await c.fetchOperations();
    expect(mw.calls.map((x) => x.url)).toEqual([
      'https://ibot4crms-middleware.enakronic.eu/api/v1/query/entities/GenericProcess:cyclefi-digital-twin',
      'https://ibot4crms-middleware.enakronic.eu/api/v1/query/entities?type=ManufacturingMachineOperation',
    ]);
    expect([PROCESS_URL, OPERATIONS_URL]).toEqual(mw.calls.map((x) => x.url));
  });

  it('exposes no way to request anything else', () => {
    expect(Object.keys(client(fakeMiddleware().fetchImpl)).sort()).toEqual(['fetchOperations', 'fetchProcess']);
  });

  it('sends GET with the token, the fixed tenancy headers, and refuses redirects', async () => {
    const mw = fakeMiddleware();
    await client(mw.fetchImpl).fetchOperations();
    const { init } = mw.calls[0]!;
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Fiware-Service': 'sc4',
      'Fiware-ServicePath': '/picvisa',
      Authorization: 'Bearer tok-123',
    });
  });

  it('reports an HTTP error by status only, without the body', async () => {
    const error = await failure(
      client((async () => new Response('secret internal detail', { status: 401 })) as typeof fetch).fetchProcess(),
    );
    expect(error.kind).toBe('http');
    expect(error.status).toBe(401);
    expect(error.message).not.toContain('secret');
  });

  it('times out', async () => {
    const hang = ((_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const error = await failure(client(hang, { timeoutMs: 20 }).fetchProcess());
    expect(error.kind).toBe('timeout');
  });

  it('reports a network, TLS or redirect failure without its detail', async () => {
    const broken = (async () => {
      throw new TypeError('fetch failed: self-signed certificate at 10.0.0.7');
    }) as typeof fetch;
    const error = await failure(client(broken).fetchProcess());
    expect(error.kind).toBe('network');
    expect(error.message).not.toContain('10.0.0.7');
  });

  it('refuses a body over the size limit, declared or not', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(5000) });
    const declared = (async () => new Response(big, { headers: { 'content-length': String(big.length) } })) as typeof fetch;
    const undeclared = (async () =>
      new Response(new Blob([big]).stream())) as typeof fetch;
    expect((await failure(client(declared, { maxBytes: 1000 }).fetchProcess())).kind).toBe('too_large');
    expect((await failure(client(undeclared, { maxBytes: 1000 }).fetchProcess())).kind).toBe('too_large');
  });

  it('refuses a body that is not JSON', async () => {
    const html = (async () => new Response('<html>login</html>')) as typeof fetch;
    expect((await failure(client(html).fetchOperations())).kind).toBe('invalid');
  });
});

describe('fixture fetch (mock mode)', () => {
  it('answers the two allowed URLs and nothing else', async () => {
    const f = createFixtureFetch();
    expect((await f(PROCESS_URL)).status).toBe(200);
    expect((await f(OPERATIONS_URL)).status).toBe(200);
    expect((await f(`${OPERATIONS_URL}&limit=1000`)).status).toBe(404);
    expect((await f('https://ibot4crms-middleware.enakronic.eu/api/v1/query/entities')).status).toBe(404);
  });
});
