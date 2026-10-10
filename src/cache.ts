/**
 * One shared value for the whole process, refreshed at most once at a time.
 *
 *  - Younger than the TTL: served from memory.
 *  - Older: the first request starts a refresh and every request arriving meanwhile
 *    waits on that same refresh. There is never more than one in flight.
 *  - Refresh failed: the last good value is served, marked stale, while it is younger
 *    than `staleMaxMs`. Past that, or with no good value yet, the error is thrown.
 *    Failures are never stored as values.
 *  - After a failure the next refresh waits `retryAfterFailureMs`, so an outage does
 *    not turn every viewer's poll into an upstream call.
 */
export interface CacheOptions<T> {
  ttlMs: number;
  staleMaxMs: number;
  load: () => Promise<T>;
  retryAfterFailureMs?: number;
  now?: () => number;
  onRefreshError?: (error: unknown) => void;
}

export interface CacheResult<T> {
  value: T;
  /** Epoch milliseconds of the successful load. */
  fetchedAt: number;
  stale: boolean;
}

export interface Cache<T> {
  get(): Promise<CacheResult<T>>;
}

export function createCache<T>(options: CacheOptions<T>): Cache<T> {
  const now = options.now ?? Date.now;
  const retryAfterFailureMs = options.retryAfterFailureMs ?? 5000;

  let good: { value: T; fetchedAt: number } | null = null;
  let failure: { error: unknown; at: number } | null = null;
  let inflight: Promise<CacheResult<T>> | null = null;

  function staleOrThrow(error: unknown): CacheResult<T> {
    if (good && now() - good.fetchedAt <= options.staleMaxMs) return { ...good, stale: true };
    throw error;
  }

  async function refresh(): Promise<CacheResult<T>> {
    try {
      const value = await options.load();
      good = { value, fetchedAt: now() };
      failure = null;
      return { ...good, stale: false };
    } catch (error) {
      failure = { error, at: now() };
      options.onRefreshError?.(error);
      return staleOrThrow(error);
    }
  }

  return {
    get() {
      if (good && now() - good.fetchedAt < options.ttlMs) {
        return Promise.resolve({ ...good, stale: false });
      }
      if (inflight) return inflight;
      if (failure && now() - failure.at < retryAfterFailureMs) {
        const { error } = failure;
        return new Promise((resolve) => resolve(staleOrThrow(error)));
      }
      inflight = refresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
