/**
 * @file /plugins/lib/syslogClient.js
 * @description Custom Syslog client supporting UDP, TCP, and TLS transports with RFC-3164 and RFC-5424 formats.
 */

const net = require('net');
const tls = require('tls');
const dgram = require('dgram');

class SyslogClient {
    constructor(opts = {}) {
        this.host = opts.host || 'localhost';
        this.port = opts.port || 514;
        this.protocol = opts.protocol || 'UDP'; // 'UDP', 'TCP', 'TLS'
        this.rfc = opts.rfc || 'RFC-5424'; // 'RFC-3164', 'RFC-5424'
        this.facility = opts.facility || 1; // Default to user-level messages
        this.appName = opts.appName || 'NTLogger';
        this.hostname = opts.hostname || require('os').hostname();
        this.transport = null;

        if (this.protocol === 'UDP') {
            this.transport = dgram.createSocket('udp4');
        } else if (this.protocol === 'TCP') {
            this.transport = new net.Socket();
        } else if (this.protocol === 'TLS') {
            this.transport = new tls.TLSSocket();
        }
    }

    /**
     * Connects to the Syslog server if using TCP or TLS.
     */
    connect() {
        if (this.protocol === 'TCP' || this.protocol === 'TLS') {
            return new Promise((resolve, reject) => {
                const options = { host: this.host, port: this.port };
                const connectListener = () => resolve();
                const errorListener = (err) => reject(err);

                if (this.protocol === 'TCP') {
                    this.transport.connect(options, connectListener).on('error', errorListener);
                } else if (this.protocol === 'TLS') {
                    this.transport.connect(options, connectListener).on('error', errorListener);
                }
            });
        }
    }

    /**
     * Sends a log message to the Syslog server.
     * @param {string} severity - The severity level of the log.
     * @param {string} message - The log message.
     * @param {object} [meta] - Additional metadata for RFC-5424 structured data.
     */
    send(severity, message, meta = {}) {
        const formattedMessage = this.formatMessage(severity, message, meta);
        if (this.protocol === 'UDP') {
            this.transport.send(Buffer.from(formattedMessage), 0, formattedMessage.length, this.port, this.host);
        } else {
            this.transport.write(formattedMessage + '\n');
        }
    }

    /**
     * Formats the Syslog message according to the selected RFC standard.
     * @param {string} severity - The severity level of the log.
     * @param {string} message - The log message.
     * @param {object} [meta] - Additional metadata for RFC-5424 structured data.
     * @returns {string} - The formatted Syslog message.
     */
    formatMessage(severity, message, meta) {
        const timestamp = new Date().toISOString();
        const priority = (this.facility * 8) + severity;

        if (this.rfc === 'RFC-3164') {
            return `<${priority}>${timestamp} ${this.hostname} ${this.appName}: ${message}`;
        } else if (this.rfc === 'RFC-5424') {
            const structuredData = this.formatStructuredData(meta.structuredData || {});
            return `<${priority}>1 ${timestamp} ${this.hostname} ${this.appName} - - ${structuredData} ${message}`;
        }
    }

    /**
     * Formats the structured data for RFC-5424.
     * @param {object} structuredData - The structured data to include in the log message.
     * @returns {string} - The formatted structured data string.
     */
    formatStructuredData(structuredData) {
        let sdString = '';
        for (const [key, value] of Object.entries(structuredData)) {
            sdString += `[${key}`;
            for (const [param, val] of Object.entries(value)) {
                sdString += ` ${param}="${val}"`;
            }
            sdString += ']';
        }
        return sdString || '-';
    }

    /**
     * Closes the transport connection.
     */
    close() {
        if (this.transport && (this.protocol === 'TCP' || this.protocol === 'TLS')) {
            this.transport.end();
        } else if (this.protocol === 'UDP') {
            this.transport.close();
        }
    }
}

module.exports = SyslogClient;
