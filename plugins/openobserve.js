/**
 * @file /plugins/openobserve.js
 * @description Sends logs to OpenObserve using HTTP API with batching support.
 */

const Transport = require('winston-transport');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const levels = require('../lib/levels');

/**
 * Strips ANSI escape codes from a string
 * @param {string} str - String to clean
 * @returns {string} - Cleaned string
 */
function stripAnsiCodes(str) {
    if (typeof str !== 'string') {
        return str;
    }
    // Remove ANSI escape codes: \u001b[ followed by numbers, semicolons, and ending with 'm'
    return str.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Recursively strips ANSI codes from all string values in an object
 * @param {any} obj - Object or value to clean
 * @returns {any} - Cleaned object or value
 */
function cleanObject(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj === 'string') {
        return stripAnsiCodes(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => cleanObject(item));
    }

    if (typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            // Skip timestamp fields
            if (key === 'timestamp' || key === 'timeCreated') {
                continue;
            }
            cleaned[key] = cleanObject(value);
        }
        return cleaned;
    }

    return obj;
}

class OpenObserveTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'OpenObserve Transport for NTLogger';

        // Required configuration
        if (!opts.host) {
            throw new Error('OpenObserve host is required');
        }
        if (!opts.organization) {
            throw new Error('OpenObserve organization is required');
        }
        if (!opts.stream) {
            throw new Error('OpenObserve stream is required');
        }
        if (!opts.username) {
            throw new Error('OpenObserve username is required');
        }
        if (!opts.password) {
            throw new Error('OpenObserve password is required');
        }

        this.host = opts.host;
        this.organization = opts.organization;
        this.stream = opts.stream;
        this.username = opts.username;
        this.password = opts.password;

        // Optional configuration
        this.batchSize = opts.batchSize || 100;
        this.timeThreshold = opts.timeThreshold || 5000;

        // Set log level
        try {
            this.level = opts.level || 'info';
            if (!(this.level in levels)) {
                throw new Error(`Invalid log level: ${this.level}`);
            }
            this.levelPriority = levels[this.level];
        } catch (error) {
            console.error(`Error setting log level: ${error.message}`);
            throw error;
        }

        // Batching queue
        this.logQueue = [];
        this.flushTimer = null;

        // Parse URL to determine protocol
        try {
            const url = new URL(this.host);
            this.protocol = url.protocol === 'https:' ? https : http;
            this.hostname = url.hostname;
            this.port = url.port || (url.protocol === 'https:' ? 443 : 80);
            // Normalize pathname: remove trailing slash if present, keep empty if no path
            this.pathname = url.pathname.replace(/\/$/, '') || '';
        } catch (error) {
            throw new Error(`Invalid host URL: ${error.message}`);
        }

        // Create Basic Auth header
        const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        this.authHeader = `Basic ${auth}`;

        // Build API endpoint path
        this.apiPath = `${this.pathname}/api/${encodeURIComponent(this.organization)}/${encodeURIComponent(this.stream)}/_json`;
    }

    /**
     * Flushes the log queue to OpenObserve
     */
    flush() {
        if (this.logQueue.length === 0) {
            return;
        }

        const logsToSend = [...this.logQueue];
        this.logQueue = [];

        // Clear the timer since we're flushing now
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        // Clean all logs: strip ANSI codes and remove timestamps
        const cleanedLogs = logsToSend.map(log => {
            const cleaned = cleanObject(log);
            // Ensure we have the essential fields
            // Note: filePath (from reportPath feature) is preserved in metadata as a separate JSON field
            // It's not in the formatted message string, ensuring clean structured data for OpenObserve
            return {
                level: cleaned.level,
                message: cleaned.message,
                ...cleaned  // Includes all metadata fields like filePath, location, ID, etc.
            };
        });

        const payload = JSON.stringify(cleanedLogs);

        const options = {
            hostname: this.hostname,
            port: this.port,
            path: this.apiPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization': this.authHeader,
            },
        };

        const req = this.protocol.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    // Success
                } else {
                    console.error(`OpenObserve API error: ${res.statusCode} - ${responseData}`);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Failed to send logs to OpenObserve: ${e.message}`);
        });

        req.write(payload);
        req.end();
    }

    /**
     * Schedules a flush after timeThreshold milliseconds
     */
    scheduleFlush() {
        if (this.flushTimer) {
            return; // Already scheduled
        }

        this.flushTimer = setTimeout(() => {
            this.flush();
        }, this.timeThreshold);
    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        const { level, message, ...meta } = info;

        // Check if log level is at or below the configured level
        if (levels[level] > this.levelPriority) {
            callback();
            return;
        }

        // Add log to queue
        this.logQueue.push({
            level,
            message,
            ...meta
        });

        // Flush if batch size is reached
        if (this.logQueue.length >= this.batchSize) {
            this.flush();
        } else {
            // Schedule a flush after timeThreshold
            this.scheduleFlush();
        }

        callback();
    }

    /**
     * Closes the transport and flushes any remaining logs
     */
    close() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.flush();
    }
}

module.exports = {
    transport: OpenObserveTransport,
};

