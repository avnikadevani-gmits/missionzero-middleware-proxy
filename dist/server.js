import { buildApp } from './app.js';
import { createCache } from './cache.js';
import { ConfigError, loadConfig } from './config.js';
import { loadLatestRun } from './twin.js';
import { createFixtureFetch, createUpstreamClient } from './upstream.js';
function readConfig() {
    try {
        return loadConfig();
    }
    catch (error) {
        if (!(error instanceof ConfigError))
            throw error;
        console.error(`Configuration error: ${error.message}`);
        process.exit(1);
    }
}
const config = readConfig();
const upstream = createUpstreamClient({
    token: config.middlewareToken,
    timeoutMs: config.upstreamTimeoutMs,
    maxBytes: config.upstreamMaxBytes,
    fetchImpl: config.mode === 'mock' ? createFixtureFetch() : undefined,
});
const cache = createCache({
    ttlMs: config.cacheTtlMs,
    staleMaxMs: config.staleMaxMs,
    load: () => loadLatestRun(upstream),
    onRefreshError: (error) => app.log.warn({ err: error }, 'middleware refresh failed'),
});
const app = await buildApp({ config, getLatest: () => cache.get() });
if (config.mode === 'mock')
    app.log.warn('MIDDLEWARE_MODE=mock: serving fixture data, not the middleware');
app.log.warn('No authentication is configured: only simulated results will be served');
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => void app.close().then(() => process.exit(0)));
}
await app.listen({ host: config.host, port: config.port });
