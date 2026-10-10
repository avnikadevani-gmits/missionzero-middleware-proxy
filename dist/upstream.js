/**
 * The only code that talks to the iBot4CRMs middleware.
 *
 * The host, the two paths and the tenancy headers are constants. Nothing a caller
 * sends can change them, there is no method other than GET, and a redirect is an
 * error rather than something to follow.
 */
import { readFile } from 'node:fs/promises';
export const MIDDLEWARE_ORIGIN = 'https://ibot4crms-middleware.enakronic.eu';
export const PROCESS_URL = `${MIDDLEWARE_ORIGIN}/api/v1/query/entities/GenericProcess:cyclefi-digital-twin`;
export const OPERATIONS_URL = `${MIDDLEWARE_ORIGIN}/api/v1/query/entities?type=ManufacturingMachineOperation`;
const TENANCY_HEADERS = { 'Fiware-Service': 'sc4', 'Fiware-ServicePath': '/picvisa' };
/** Carries a kind and, for `http`, a status. Never the upstream body. */
export class UpstreamError extends Error {
    kind;
    status;
    constructor(kind, message, status, options) {
        super(message, options);
        this.kind = kind;
        this.status = status;
        this.name = 'UpstreamError';
    }
}
async function readBody(response, maxBytes) {
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
        await response.body?.cancel();
        throw new UpstreamError('too_large', 'middleware response exceeds the size limit');
    }
    if (!response.body)
        return '';
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            throw new UpstreamError('too_large', 'middleware response exceeds the size limit');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}
export function createUpstreamClient(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const headers = { Accept: 'application/json', ...TENANCY_HEADERS };
    if (options.token)
        headers.Authorization = `Bearer ${options.token}`;
    async function get(url) {
        try {
            const response = await fetchImpl(url, {
                method: 'GET',
                headers,
                redirect: 'error',
                signal: AbortSignal.timeout(options.timeoutMs),
            });
            if (!response.ok) {
                await response.body?.cancel();
                throw new UpstreamError('http', `middleware answered HTTP ${response.status}`, response.status);
            }
            const text = await readBody(response, options.maxBytes);
            try {
                return JSON.parse(text);
            }
            catch {
                throw new UpstreamError('invalid', 'middleware response is not JSON');
            }
        }
        catch (error) {
            if (error instanceof UpstreamError)
                throw error;
            const name = error instanceof Error ? error.name : '';
            if (name === 'TimeoutError' || name === 'AbortError') {
                throw new UpstreamError('timeout', 'middleware did not answer in time');
            }
            // Includes DNS, connection, redirect and TLS failures. The cause is for the server log only.
            throw new UpstreamError('network', 'middleware could not be reached', undefined, { cause: error });
        }
    }
    return {
        fetchProcess: () => get(PROCESS_URL),
        fetchOperations: () => get(OPERATIONS_URL),
    };
}
/**
 * Mock mode: a `fetch` that answers the two allowed URLs from fixtures/ and nothing
 * else, so the client, filter and cache run exactly as they do live.
 */
export function createFixtureFetch(dir = new URL('../fixtures/', import.meta.url)) {
    return async (input) => {
        const url = String(input);
        const file = url === PROCESS_URL ? 'process.json' : url === OPERATIONS_URL ? 'operations.json' : null;
        if (!file)
            return new Response('', { status: 404 });
        return new Response(await readFile(new URL(file, dir)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
}
