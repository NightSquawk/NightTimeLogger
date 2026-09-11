/**
 * @file /plugins/openobserve.js
 * @description Sends logs to OpenObserve using HTTP API with batching support.
 */

const Transport = require('winston-transport');
const { URL } = require('url');
const levels = require('../lib/levels');
const { HttpDelivery } = require('./lib/httpDelivery');

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
            if (key === 'timeCreated') {
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
        this.timeThreshold = opts.timeThreshold ?? 5000;
        if (!Number.isInteger(this.batchSize) || this.batchSize < 1 || !Number.isFinite(this.timeThreshold) || this.timeThreshold < 0) {
            throw new Error('Invalid batching configuration');
        }

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

        const url = new URL(this.host);
        this.pathname = url.pathname.replace(/\/$/, '') || '';

        // Create Basic Auth header
        const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        this.authHeader = `Basic ${auth}`;

        // Build API endpoint path
        this.apiPath = `${this.pathname}/api/${encodeURIComponent(this.organization)}/${encodeURIComponent(this.stream)}/_json`;
        const endpoint = new URL(this.host);
        endpoint.pathname = this.apiPath;
        this.delivery = new HttpDelivery(endpoint, opts);
    }

    log(info, callback) {
        if (levels[info.level] > this.levelPriority) { callback(); return; }
        if (this.closed) { callback(new Error('OpenObserve transport is closed')); return; }
        this.logQueue.push(info);
        if (this.logQueue.length >= this.batchSize) this._flush();
        else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this._flush(), this.timeThreshold);
            this.flushTimer.unref();
        }
        callback();
    }

    _flush() {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
        if (!this.logQueue.length) return;
        const batch = this.logQueue.splice(0);
        try {
            const payload = JSON.stringify(batch.map(log => cleanObject(log)));
            this.delivery.send(payload, { Authorization: this.authHeader }).catch(() => {});
        } catch (error) { this.delivery.failure = error; }
    }

    async flush() {
        this._flush();
        await this.delivery.flush();
    }

    close() {
        this.closed = true;
        return this.flush();
    }
}

module.exports = { transport: OpenObserveTransport };
