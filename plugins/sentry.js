/**
 * @file /plugins/sentry.js
 * @description Initializes the Sentry SDK for error tracking and defines a custom Winston transport.
 *
 * `@sentry/node` is an optional peer dependency. Install it when using this plugin:
 *   npm install @sentry/node
 */

const Transport = require('winston-transport');

/**
 * Requires an optional peer dependency, translating only that package's
 * MODULE_NOT_FOUND into an actionable install message. Any other failure
 * (including a missing module *inside* the package) propagates unchanged.
 * @param {string} moduleId - The module specifier to require.
 * @param {string} packageName - The npm package to install.
 * @returns {*} The resolved module.
 */
function requirePeer(moduleId, packageName) {
    try {
        return require(moduleId);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(`'${moduleId}'`)) {
            throw new Error(`ntlogger Sentry plugin requires '${packageName}'. Install it with: npm install ${packageName}`);
        }
        throw err;
    }
}

const Sentry = requirePeer('@sentry/node', '@sentry/node');

/**
 * Custom Winston transport for sending logs to Sentry.
 */
class SentryTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'Sentry Transport for NTLogger';
        this.flushTimeout = opts.flushTimeout ?? 5000;
        this.init(opts);
    }

    /**
     * Initializes the Sentry SDK with the provided configuration.
     * @param {Object} config - The configuration object for Sentry initialization.
     */
    init(config = {}) {
        try {
            Sentry.init({...config});
        } catch (err) {
            console.error(`Failed to initialize ${this.name}:`, err);
        }
    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        const { level, message, ...meta } = info;

        if (level === 'error') {
            const error = new Error(message);
            if (meta.stack) error.stack = meta.stack;
            Sentry.captureException(error, { extra: meta });
        } else {
            Sentry.captureMessage(message, { level: ({ warn: 'warning', trace: 'debug', internal: 'debug' })[level] || level, extra: meta });
        }

        callback();
    }
    async flush() {
        if (!await Sentry.flush(this.flushTimeout)) throw new Error('Sentry flush timed out');
    }

    // Flush without disabling the SDK shared with the host application.
    close() { return this.flush(); }

}

module.exports = {
    transport: SentryTransport,
};
