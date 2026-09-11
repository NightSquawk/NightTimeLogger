'use strict';

/**
 * ntlogger/pino — advanced example.
 *
 * Request-scoped context via AsyncLocalStorage, secret redaction, rate
 * limiting, and opt-in crash/signal handlers.
 *
 * Run with:  NODE_ENV=development node examples/pino-advanced.js
 */

const { AsyncLocalStorage } = require('async_hooks');
const { createLogger } = require('../pino'); // in your app: require('ntlogger/pino')

const requestContext = new AsyncLocalStorage();

const log = createLogger({
    module: 'OrderService',
    service: 'checkout-api',

    // Constant fields on every line.
    context: { region: process.env.AWS_REGION || 'us-east-1' },

    // Per-call fields. Returning the ALS store is the intended usage; only the
    // keys listed in contextKeys are copied out, so the store can be as big as
    // the application needs.
    contextProvider: () => requestContext.getStore(),
    contextKeys: ['tenantId', 'userId', 'correlationId'],

    // Redaction is on by default; this only adds an app-specific key.
    redact: ['deviceFingerprint'],

    // Keep a chatty level from flooding the pipeline.
    rateLimit: { info: { max: 100, window: 60000 } },
    deduplication: { enabled: true, threshold: 3, window: 60000 },

    // Log fatal, run the shutdown hook, drain, exit — explicitly opted in.
    processHandlers: {
        timeout: 4000,
        onShutdown: async reason => {
            log.info({ reason }, 'draining connections');
        },
    },
});

/**
 * Pretend HTTP handler. Everything logged inside `run()` carries the context.
 * @param {object} req - Fake request.
 * @returns {void}
 */
function handleRequest(req) {
    requestContext.run({ tenantId: req.tenantId, userId: req.userId, correlationId: req.id }, () => {
        log.info('order received');

        // Secrets never reach the transport: keys, message text and Error
        // messages all go through the redactor.
        log.debug({ headers: { authorization: `Bearer ${req.token}` } }, 'calling payments');

        try {
            throw new Error(`payment declined for card token ${req.token}`);
        } catch (err) {
            log.error({ err, deviceFingerprint: req.fingerprint }, 'order failed');
        }
    });
}

handleRequest({ id: 'corr-1', tenantId: 'acme', userId: 'u-42', token: 'sk_live_9f8e7d6c5b4a3210', fingerprint: 'fp-xyz' });

log.info({ stats: log.getStats() }, 'sampling snapshot');

// close() releases the sampler/dedup timers and flushes the transport.
log.close(5000).then(() => log.uninstallProcessHandlers());
