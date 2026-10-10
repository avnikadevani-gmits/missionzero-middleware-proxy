import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createCache } from '../src/cache.js';
import type { Config } from '../src/config.js';
import { loadLatestRun } from '../src/twin.js';
import { createFixtureFetch, createUpstreamClient } from '../src/upstream.js';
import { fakeMiddleware, findOp, LATEST, operationsFixture, processFixture, testConfig, type Raw } from './helpers.js';

const ORIGIN = 'https://missionzero.gr';
const PATH = '/api/digital-twin/latest';
let app: FastifyInstance;

afterEach(() => app?.close());

/** The real pipeline (client, filter, cache, routes) over a fake middleware. */
async function start(fetchImpl: typeof fetch, overrides: Partial<Config> = {}) {
  const config = testConfig(overrides);
  const clock = { t: Date.parse('2026-10-10T08:00:00Z') };
  const upstream = createUpstreamClient({
    token: config.middlewareToken,
    timeoutMs: config.upstreamTimeoutMs,
    maxBytes: config.upstreamMaxBytes,
    fetchImpl,
  });
  const cache = createCache({
    ttlMs: config.cacheTtlMs,
    staleMaxMs: config.staleMaxMs,
    now: () => clock.t,
    load: () => loadLatestRun(upstream),
  });
  app = await buildApp({ config, getLatest: () => cache.get(), logger: false });
  return { clock };
}

describe('GET /api/digital-twin/latest', () => {
  it('returns the filtered latest run', async () => {
    const mw = fakeMiddleware();
    await start(mw.fetchImpl);
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe(LATEST);
    expect(body.results.map((r: Raw) => r.material)).toEqual(['pcb', 'cu', 'al']);
    expect(body).toMatchObject({ source: 'middleware', stale: false, fetchedAt: '2026-10-10T08:00:00.000Z' });
    expect(body.dataStatus).toMatchObject({ simulated: true, placeholderModel: true, validated: false });
    // Nothing of the other runs, the other partner, or the raw collection.
    expect(res.body).not.toContain('sc4-1791154668076');
    expect(res.body).not.toContain('other-partner');
    expect(res.body).not.toContain('operationOutput');
  });

  it('never returns the token or the middleware address', async () => {
    await start(fakeMiddleware().fetchImpl);
    const res = await app.inject({ method: 'GET', url: PATH });
    const everything = res.body + JSON.stringify(res.headers);
    expect(everything).not.toContain('test-token-do-not-leak');
    expect(everything).not.toContain('enakronic');
  });

  it('sets safe response headers', async () => {
    await start(fakeMiddleware().fetchImpl);
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('refuses query parameters instead of forwarding them', async () => {
    const mw = fakeMiddleware();
    await start(mw.fetchImpl);
    for (const q of ['?type=MLModel', '?id=GenericProcess:other', '?url=https://example.com', '?run=sc4-1']) {
      const res = await app.inject({ method: 'GET', url: PATH + q });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_request');
    }
    expect(mw.calls).toHaveLength(0);
  });

  it('ignores tenancy and authorization headers sent by the caller', async () => {
    const mw = fakeMiddleware();
    await start(mw.fetchImpl);
    await app.inject({
      method: 'GET',
      url: PATH,
      headers: {
        'fiware-service': 'sc1',
        'fiware-servicepath': '/other',
        authorization: 'Bearer attacker',
        'x-forwarded-host': 'evil.example',
      },
    });
    for (const call of mw.calls) {
      expect(call.init.headers).toEqual({
        Accept: 'application/json',
        'Fiware-Service': 'sc4',
        'Fiware-ServicePath': '/picvisa',
        Authorization: 'Bearer test-token-do-not-leak',
      });
    }
  });

  it('exposes no other route, and no path through to the middleware', async () => {
    const mw = fakeMiddleware();
    await start(mw.fetchImpl);
    for (const url of ['/', '/mw/query/entities', '/api/v1/query/entities', '/api/digital-twin', `${PATH}/x`]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: { code: 'not_found', message: 'Not found.', translations: { el: { message: 'Δεν βρέθηκε.' } } },
      });
    }
    expect(mw.calls).toHaveLength(0);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const)('refuses %s', async (method) => {
    const mw = fakeMiddleware();
    await start(mw.fetchImpl);
    const res = await app.inject({ method, url: PATH });
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('GET');
    expect(mw.calls).toHaveLength(0);
  });
});

describe('health', () => {
  it('answers without touching the middleware or revealing anything', async () => {
    const mw = fakeMiddleware();
    await start(mw.fetchImpl);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(mw.calls).toHaveLength(0);
  });
});

describe('CORS', () => {
  it('allows the approved origin', async () => {
    await start(fakeMiddleware().fetchImpl);
    const res = await app.inject({ method: 'GET', url: PATH, headers: { origin: ORIGIN } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers a preflight for GET only', async () => {
    await start(fakeMiddleware().fetchImpl);
    const res = await app.inject({
      method: 'OPTIONS',
      url: PATH,
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toBe('GET');
  });

  it.each(['https://evil.example', 'http://missionzero.gr', 'https://missionzero.gr.evil.example', 'null'])(
    'refuses origin %s',
    async (origin) => {
      const mw = fakeMiddleware();
      await start(mw.fetchImpl);
      for (const method of ['GET', 'OPTIONS'] as const) {
        const res = await app.inject({
          method,
          url: PATH,
          headers: { origin, 'access-control-request-method': 'GET' },
        });
        expect(res.statusCode).toBe(403);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
      expect(mw.calls).toHaveLength(0);
    },
  );

  it('sends no CORS grant to a request without an origin', async () => {
    await start(fakeMiddleware().fetchImpl);
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('cache behind the endpoint', () => {
  it('makes two upstream calls for many concurrent viewers', async () => {
    const mw = fakeMiddleware();
    await start(mw.fetchImpl);
    const all = await Promise.all(Array.from({ length: 40 }, () => app.inject({ method: 'GET', url: PATH })));
    expect(all.every((r) => r.statusCode === 200)).toBe(true);
    expect(mw.calls).toHaveLength(2);
  });

  it('reuses the result inside the TTL and refreshes after it', async () => {
    const mw = fakeMiddleware();
    const { clock } = await start(mw.fetchImpl);
    await app.inject({ method: 'GET', url: PATH });
    clock.t += 10000;
    await app.inject({ method: 'GET', url: PATH });
    expect(mw.calls).toHaveLength(2);
    clock.t += 5000;
    await app.inject({ method: 'GET', url: PATH });
    expect(mw.calls).toHaveLength(4);
  });

  it('picks up a new run once the process names it', async () => {
    const mw = fakeMiddleware();
    const { clock } = await start(mw.fetchImpl);
    expect((await app.inject({ method: 'GET', url: PATH })).json().run.id).toBe(LATEST);
    (mw.state.process as Raw).lastRun.value = 'sc4-1791154668076';
    clock.t += 15000;
    expect((await app.inject({ method: 'GET', url: PATH })).json().run.id).toBe('sc4-1791154668076');
  });
});

describe('upstream trouble', () => {
  const failing = (status: number) =>
    (async () => new Response('upstream stack trace: db01.internal password=hunter2', { status })) as typeof fetch;

  it('answers 502 with a fixed message and none of the upstream body', async () => {
    await start(failing(500));
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: {
        code: 'upstream_unavailable',
        message: 'The data source is unavailable or returned an unusable answer.',
        translations: {
          el: { message: 'Η πηγή δεδομένων δεν είναι διαθέσιμη ή επέστρεψε μη αξιοποιήσιμη απάντηση.' },
        },
      },
    });
    expect(res.body).not.toMatch(/hunter2|db01|test-token|enakronic|stack/);
  });

  it('answers 502, not a login page, when the token is rejected', async () => {
    await start(failing(401));
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.statusCode).toBe(502);
  });

  it('answers 504 on a timeout', async () => {
    const hang = ((_u: unknown, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    await start(hang, { upstreamTimeoutMs: 500 });
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.statusCode).toBe(504);
    expect(res.json().error.code).toBe('upstream_timeout');
  });

  it('answers 502 when the process is not ours, and does not fetch operations', async () => {
    const mw = fakeMiddleware();
    (mw.state.process as Raw).owner = ['other-partner'];
    await start(mw.fetchImpl);
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('other-partner');
    expect(mw.calls).toHaveLength(1);
  });

  it('serves the last good run, marked stale, while the middleware is down', async () => {
    const mw = fakeMiddleware();
    let down = false;
    const flaky = ((url: unknown, init?: RequestInit) =>
      down ? Promise.resolve(new Response('no', { status: 503 })) : mw.fetchImpl(url as string, init)) as typeof fetch;
    const { clock } = await start(flaky, { staleMaxMs: 60000 });
    await app.inject({ method: 'GET', url: PATH });

    down = true;
    clock.t += 20000;
    const stale = await app.inject({ method: 'GET', url: PATH });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ stale: true, fetchedAt: '2026-10-10T08:00:00.000Z' });

    clock.t += 60000;
    expect((await app.inject({ method: 'GET', url: PATH })).statusCode).toBe(502);
  });

  it('does not cache a malformed answer', async () => {
    const mw = fakeMiddleware();
    const good = mw.state.process;
    mw.state.process = { unexpected: true };
    const { clock } = await start(mw.fetchImpl);
    expect((await app.inject({ method: 'GET', url: PATH })).statusCode).toBe(502);
    mw.state.process = good;
    clock.t += 5000;
    expect((await app.inject({ method: 'GET', url: PATH })).statusCode).toBe(200);
  });
});

describe('the public-preview gate', () => {
  const serve = async (edit: (ops: Raw[], process: Raw) => void = () => {}) => {
    const ops = operationsFixture();
    const process = processFixture();
    edit(ops, process);
    const mw = fakeMiddleware(process, ops);
    await start(mw.fetchImpl);
    return { res: await app.inject({ method: 'GET', url: PATH }), mw };
  };
  const expectLocked = ({ res }: Awaited<ReturnType<typeof serve>>) => {
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'preview_locked',
        message: 'These results are not available through the public preview.',
        translations: {
          el: { message: 'Αυτά τα αποτελέσματα δεν είναι διαθέσιμα μέσω της δημόσιας προεπισκόπησης.' },
        },
      },
    });
    // Not one figure of the run, simulated or otherwise, and no reason that names an entity.
    expect(res.body).not.toMatch(/99\.1|95\.93|84\.92|92\.97|77\.92|95\.43|sc4-|dataProvenance|dataSource/);
  };
  const text = (value: unknown) => ({ type: 'Text', value });

  it('serves a valid simulated latest run', async () => {
    const { res } = await serve();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.process).toMatchObject({ dataSource: 'simulated', dataProvenance: null });
    expect(body.results).toHaveLength(3);
    expect(body).not.toHaveProperty('previewBlockers');
  });

  it('blocks everything when a latest-run operation has no provenance', async () => {
    expectLocked(await serve((ops) => delete findOp(ops, LATEST, 'pcb').dataProvenance));
  });

  it('blocks everything when a latest-run figure has no dataSource', async () => {
    expectLocked(await serve((ops) => delete findOp(ops, LATEST, 'cu').purity.metadata.dataSource));
  });

  it('blocks everything when a latest-run operation is marked measured', async () => {
    expectLocked(
      await serve((ops) => {
        const pcb = findOp(ops, LATEST, 'pcb');
        pcb.dataProvenance.value = 'measured';
        pcb.purity.metadata.dataSource.value = 'measured';
      }),
    );
  });

  it('blocks everything when one figure among simulated ones is measured', async () => {
    expectLocked(await serve((ops) => (findOp(ops, LATEST, 'al').purity.metadata.dataSource.value = 'measured')));
  });

  it('serves the latest run when an older run has invalid provenance', async () => {
    const { res } = await serve((ops) => {
      delete findOp(ops, 'sc4-1791154668076', 'pcb').dataProvenance;
      findOp(ops, 'sc4-1791153827302', 'cu').dataProvenance.value = 'measured';
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(3);
  });

  it("serves the latest run when another partner's operation has invalid provenance", async () => {
    const { res } = await serve((ops) => {
      const theirs = ops.find((o) => o.owner[0] === 'other-partner')!;
      delete theirs.dataProvenance;
      theirs.purity.metadata.dataSource.value = 'measured';
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(3);
    expect(res.body).not.toContain('other-partner');
  });

  it('blocks when the run has no results, or none that is ours', async () => {
    expectLocked(await serve((ops) => ops.splice(0, ops.length)));
    await app.close();
    expectLocked(
      await serve((ops) => {
        for (const m of ['pcb', 'cu', 'al']) findOp(ops, LATEST, m).owner = ['other-partner'];
      }),
    );
  });

  it('serves a process with dataSource simulated', async () => {
    const { res } = await serve((_ops, p) => (p.dataSource = text('simulated')));
    expect(res.statusCode).toBe(200);
  });

  it('blocks a process with dataSource measured', async () => {
    expectLocked(await serve((_ops, p) => (p.dataSource = text('measured'))));
  });

  it('blocks a process with no dataSource', async () => {
    expectLocked(await serve((_ops, p) => delete p.dataSource));
  });

  it('blocks a process whose dataSource is unreadable', async () => {
    expectLocked(await serve((_ops, p) => (p.dataSource = text('dummy'))));
  });

  it('blocks a process whose two classification fields contradict each other', async () => {
    expectLocked(
      await serve((_ops, p) => {
        p.dataSource = text('simulated');
        p.dataProvenance = text('measured');
      }),
    );
  });

  it('serves a process whose dataProvenance agrees with its dataSource', async () => {
    const { res } = await serve((_ops, p) => (p.dataProvenance = text('simulated')));
    expect(res.statusCode).toBe(200);
    expect(res.json().process).toMatchObject({ dataSource: 'simulated', dataProvenance: 'simulated' });
  });

  it('keeps refusing from the cache, without a new upstream call per request', async () => {
    const { mw } = await serve((_ops, p) => delete p.dataSource);
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'GET', url: PATH })).statusCode).toBe(503);
    expect(mw.calls).toHaveLength(2);
  });
});

describe('rate limiting', () => {
  it('answers 429 past the limit, in the usual error shape', async () => {
    await start(fakeMiddleware().fetchImpl, { rateLimitPerMinute: 3 });
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'GET', url: PATH })).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: PATH });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('rate_limited');
  });
});

describe('mock mode', () => {
  it('runs the same pipeline over the fixtures and says so in the response', async () => {
    await start(createFixtureFetch(), { mode: 'mock', middlewareToken: null });
    const body = (await app.inject({ method: 'GET', url: PATH })).json();
    expect(body.source).toBe('mock');
    expect(body.results).toHaveLength(3);
    expect(body.run.id).toBe(LATEST);
  });
});
