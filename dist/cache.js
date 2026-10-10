export function createCache(options) {
    const now = options.now ?? Date.now;
    const retryAfterFailureMs = options.retryAfterFailureMs ?? 5000;
    let good = null;
    let failure = null;
    let inflight = null;
    function staleOrThrow(error) {
        if (good && now() - good.fetchedAt <= options.staleMaxMs)
            return { ...good, stale: true };
        throw error;
    }
    async function refresh() {
        try {
            const value = await options.load();
            good = { value, fetchedAt: now() };
            failure = null;
            return { ...good, stale: false };
        }
        catch (error) {
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
            if (inflight)
                return inflight;
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
