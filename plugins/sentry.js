/**
 * @file /plugins/sentry.js
 * @description Initializes the Sentry SDK for error tracking and defines a custom Winston transport.
 */

const Transport = require('winston-transport');
const Sentry = require("@sentry/node");

/**
 * Custom Winston transport for sending logs to Sentry.
 */
class SentryTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'Sentry Transport for NTLogger';
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
            Sentry.captureException(new Error(message), { extra: meta });
        } else {
            Sentry.captureMessage(message, { level, extra: meta });
        }

        callback();
    }
}

module.exports = {
    transport: SentryTransport,
};
