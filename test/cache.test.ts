import { describe, expect, it, vi } from 'vitest';
import { createCache } from '../src/cache.js';

function setup(overrides: { staleMaxMs?: number } = {}) {
  const clock = { t: 1_000_000 };
  let n = 0;
  const load = vi.fn(async () => `value-${++n}`);
  const cache = createCache({
    ttlMs: 15000,
    staleMaxMs: overrides.staleMaxMs ?? 600000,
    retryAfterFailureMs: 5000,
    load,
    now: () => clock.t,
  });
  return { clock, load, cache };
}

describe('cache', () => {
  it('serves every viewer from one load inside the TTL', async () => {
    const { cache, load, clock } = setup();
    expect(await cache.get()).toEqual({ value: 'value-1', fetchedAt: 1_000_000, stale: false });
    clock.t += 14999;
    expect((await cache.get()).value).toBe('value-1');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL', async () => {
    const { cache, load, clock } = setup();
    await cache.get();
    clock.t += 15000;
    expect(await cache.get()).toEqual({ value: 'value-2', fetchedAt: 1_015_000, stale: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh between concurrent requests', async () => {
    const { cache, load, clock } = setup();
    const first = await Promise.all(Array.from({ length: 25 }, () => cache.get()));
    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(first.map((r) => r.value))).toEqual(new Set(['value-1']));

    clock.t += 20000;
    const second = await Promise.all(Array.from({ length: 25 }, () => cache.get()));
    expect(load).toHaveBeenCalledTimes(2);
    expect(new Set(second.map((r) => r.value))).toEqual(new Set(['value-2']));
  });

  it('throws, and stores nothing, when the first load fails', async () => {
    const { cache, load, clock } = setup();
    load.mockRejectedValueOnce(new Error('down'));
    await expect(cache.get()).rejects.toThrow('down');
    clock.t += 5000;
    expect((await cache.get()).value).toBe('value-1');
  });

  it('serves the last good value as stale when a refresh fails', async () => {
    const { cache, load, clock } = setup();
    await cache.get();
    clock.t += 20000;
    load.mockRejectedValueOnce(new Error('down'));
    expect(await cache.get()).toEqual({ value: 'value-1', fetchedAt: 1_000_000, stale: true });
  });

  it('stops serving stale past the limit', async () => {
    const { cache, load, clock } = setup({ staleMaxMs: 60000 });
    await cache.get();
    clock.t += 60001;
    load.mockRejectedValueOnce(new Error('down'));
    await expect(cache.get()).rejects.toThrow('down');
  });

  it('never serves stale when staleMaxMs is 0', async () => {
    const { cache, load, clock } = setup({ staleMaxMs: 0 });
    await cache.get();
    clock.t += 15000;
    load.mockRejectedValueOnce(new Error('down'));
    await expect(cache.get()).rejects.toThrow('down');
  });

  it('does not call upstream again straight after a failure', async () => {
    const { cache, load, clock } = setup();
    load.mockRejectedValue(new Error('down'));
    await expect(cache.get()).rejects.toThrow('down');
    clock.t += 4999;
    await expect(cache.get()).rejects.toThrow('down');
    expect(load).toHaveBeenCalledTimes(1);
    clock.t += 1;
    await expect(cache.get()).rejects.toThrow('down');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('recovers on the first good refresh', async () => {
    const { cache, load, clock } = setup();
    await cache.get();
    clock.t += 20000;
    load.mockRejectedValueOnce(new Error('down'));
    expect((await cache.get()).stale).toBe(true);
    clock.t += 5000;
    const next = await cache.get();
    expect(next.stale).toBe(false);
    expect(next.fetchedAt).toBe(clock.t);
  });
});
