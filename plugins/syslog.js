/**
 * @file /plugins/syslog.js
 * @description Sends logs to a Syslog server using custom Syslog client.
 */

const Transport = require('winston-transport');
const SyslogClient = require('./lib/syslogClient');

class SyslogTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'Syslog Transport for NTLogger';
        this.client = new SyslogClient({
            host: opts.host || 'localhost',
            port: opts.port || 514,
            protocol: opts.protocol || 'UDP', // Options: 'UDP', 'TCP', 'TLS'
            rfc: opts.rfc || 'RFC-5424', // Options: 'RFC-3164', 'RFC-5424'
            facility: opts.facility ?? 1,
            appName: opts.appName || 'NTLogger',
            hostname: opts.hostname || require('os').hostname(),
        });

        this.severities = {
            internal: 7, // Debug level for internal logs
            trace: 7,    // Debug
            debug: 7,    // Debug
            info: 6,     // Informational
            warn: 4,     // Warning
            error: 3,    // Error
            fatal: 2,    // Critical
        };
        this.logLevel = opts.level ? this.severities[opts.level] : this.severities.info;

        if (this.client.protocol === 'TCP' || this.client.protocol === 'TLS') {
            this.client.connect().catch(err => {
                console.error(`Failed to connect to Syslog server at ${this.client.host}:${this.client.port}:`, err);
            });
        }
    }

    /**
     * Logs messages to the Syslog server.
     * @param {Object} info - Log information.
     * @param {Function} callback - Callback function.
     */
    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        const { level, message, ...meta } = info;

        if (this.severities[level] > this.logLevel) {
            callback();
            return;
        }

        this.client.send(this.severities[level], message, meta, callback);
    }

    /**
     * Checks if the Syslog client is active.
     * @returns {boolean} - True if the client is active, false otherwise.
     */
    isActive() {
        return this.client && (this.client.protocol === 'UDP' || (this.client.transport && !this.client.transport.destroyed));
    }

    /**
     * Closes the Syslog client connection.
     * @returns {Promise<void>}
     */
    async close() {
        await this.client.close();
    }
}

module.exports = {
    transport: SyslogTransport,
};
