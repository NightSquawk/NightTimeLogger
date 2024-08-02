/**
 * @file /plugins/jest.js
 * @description Stores log messages in memory for Jest testing.
 */

const Transport = require('winston-transport');

/**
 * Custom Winston transport for storing logs in memory for Jest assertions.
 */
class JestTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'JestTransport';
        this.disc = 'Stores log messages in memory for Jest testing.';
        this.logMessages = [];
    }

    /**
     * Logs the message and stores it in memory.
     * @param {Object} info - The log information object containing the message, level, and other metadata.
     * @param {Function} callback - Callback function to indicate logging completion.
     */
    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        const { level, message, ...meta } = info;

        // Store the log message in memory
        this.logMessages.push({ level, message, meta });

        callback();
    }

    /**
     * Retrieve stored log messages filtered by a specific level, if provided.
     * @param {string} [level] - The log level to filter messages by (e.g., 'info', 'error').
     * @returns {Array} Array of filtered or all log messages.
     */
    getMessages(level) {
        if (level) {
            return this.logMessages.filter(log => log.level === level);
        }
        return this.logMessages;
    }

    /**
     * Clear all stored log messages.
     */
    clearMessages() {
        this.logMessages = [];
    }
}

module.exports = {
    transport: JestTransport,
};
