import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { assertPublicPreviewAllowed, PreviewLockedError } from './access.js';
import type { CacheResult } from './cache.js';
import type { Config } from './config.js';
import { ERRORS, type Message } from './messages.js';
import { UpstreamError } from './upstream.js';
import type { LatestRunRead } from './twin.js';
import type { ErrorResponse, LatestRunResponse } from './types.js';

export interface AppDeps {
  config: Config;
  getLatest: () => Promise<CacheResult<LatestRunRead>>;
  /** Tests switch logging off. */
  logger?: boolean;
}

const fail = (code: string, message: Message): ErrorResponse => ({
  error: { code, message: message.en, translations: { el: { message: message.el } } },
});

const CLIENT_ERRORS: Record<number, ErrorResponse> = {
  400: fail('invalid_request', ERRORS.invalidRequest),
  404: fail('not_found', ERRORS.notFound),
  413: fail('invalid_request', ERRORS.tooLarge),
  429: fail('rate_limited', ERRORS.rateLimited),
};

export async function buildApp({ config, getLatest, logger = true }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger
      ? { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] }
      : false,
    // Nginx on this machine is the only client; its X-Forwarded-For is the real address.
    trustProxy: '127.0.0.1',
    bodyLimit: 1024,
    exposeHeadRoutes: false,
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send(fail('origin_not_allowed', ERRORS.originNotAllowed));
    }
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof UpstreamError) {
      request.log.error({ kind: error.kind, upstreamStatus: error.status }, error.message);
      return error.kind === 'timeout'
        ? reply.code(504).send(fail('upstream_timeout', ERRORS.upstreamTimeout))
        : reply.code(502).send(fail('upstream_unavailable', ERRORS.upstreamUnavailable));
    }
    if (error instanceof PreviewLockedError) {
      request.log.error(error.message);
      return reply
        .code(503)
        .send(fail('preview_locked', ERRORS.previewLocked));
    }
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send(CLIENT_ERRORS[status] ?? CLIENT_ERRORS[400]);
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(fail('internal_error', ERRORS.internal));
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET') {
      return reply
        .code(405)
        .header('Allow', 'GET')
        .send(fail('method_not_allowed', ERRORS.methodNotAllowed));
    }
    return reply.code(404).send(CLIENT_ERRORS[404]);
  });

  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET'],
    allowedHeaders: ['Accept', 'Content-Type'],
    credentials: false,
    maxAge: 600,
  });
  await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/digital-twin/latest', async (request, reply): Promise<LatestRunResponse | ErrorResponse> => {
    if (Object.keys(request.query as object).length > 0) {
      return reply.code(400).send(fail('invalid_request', ERRORS.noParameters));
    }
    // Authentication and per-user scenario authorization go here, before the cache. See access.ts.
    const { value, fetchedAt, stale } = await getLatest();
    assertPublicPreviewAllowed(value);
    return {
      ...value.run,
      source: config.mode === 'mock' ? 'mock' : 'middleware',
      fetchedAt: new Date(fetchedAt).toISOString(),
      stale,
    };
  });

  return app;
}
