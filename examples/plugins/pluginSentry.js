// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

const { nodeProfilingIntegration } = require("@sentry/profiling-node");

// Configure the Logger
let config = {
    level: 'internal',
    file: false,
    plugins: [
        {
            name: 'Sentry',
            config: {
                dsn: process.env.SENTRY_DSN || null,
                release: process.env.SENTRY_RELEASE || null,
                tracesSampleRate: 1.0,
                profilesSampleRate: 1.0,
                environment: process.env.NODE_ENV || 'development',
                debug: false,
                attachStacktrace: true,
                integrations: [
                    nodeProfilingIntegration()
                ],
                serverName: null,
                maxBreadcrumbs: 100,
                autoSessionTracking: true,
                sessionTracking: {},
                tracesSampler: null
            }
        }
    ],
}

// Create a logger instance
const log = logger('Plugin Example - Sentry', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
