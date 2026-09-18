'use strict';

const http = require('http');
const https = require('https');

// Hard ceiling for any retry delay derived from a remote server's response
// (e.g. a `Retry-After` header), independent of the configured `timeout`.
// Bounding against this literal - rather than only against the
// instance's own `this.timeout` - keeps a remote endpoint from ever being
// able to schedule an arbitrarily long-lived timer.
const MAX_RETRY_WAIT_MS = 60_000;

class HttpDelivery {
    constructor(url, opts = {}) {
        this.url = new URL(url);
        if (!['http:', 'https:'].includes(this.url.protocol)) throw new Error('Expected an HTTP(S) URL');
        this.timeout = opts.timeout ?? 5000;
        this.maxRetries = opts.maxRetries ?? 3;
        this.retryDelay = opts.retryDelay ?? 1000;
        this.maxPending = opts.maxPending ?? 100;
        for (const [name, value] of Object.entries({ timeout: this.timeout, maxPending: this.maxPending })) {
            if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
        }
        if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || !Number.isFinite(this.retryDelay) || this.retryDelay < 0) {
            throw new Error('Invalid retry configuration');
        }
        this.pending = new Set();
        this.failure = null;
    }

    send(payload, headers = {}) {
        if (this.pending.size >= this.maxPending) {
            const error = new Error('HTTP delivery queue is full');
            this.failure = error;
            return Promise.reject(error);
        }
        const operation = this.deliver(payload, headers);
        this.pending.add(operation);
        operation.then(() => this.pending.delete(operation), error => {
            this.failure = error;
            this.pending.delete(operation);
        });
        return operation;
    }

    async deliver(payload, headers) {
        for (let attempt = 0; ; attempt++) {
            try { return await this.request(payload, headers); }
            catch (error) {
                if (error.retryable === false || attempt >= this.maxRetries) throw error;
                const wait = Math.min(error.retryAfter ?? this.retryDelay * 2 ** attempt, this.timeout, MAX_RETRY_WAIT_MS);
                await new Promise(resolve => setTimeout(resolve, wait));
            }
        }
    }

    request(payload, headers) {
        return new Promise((resolve, reject) => {
            const protocol = this.url.protocol === 'https:' ? https : http;
            let timer;
            const req = protocol.request(this.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
            }, res => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    body += chunk;
                    if (body.length > 1048576) req.destroy(new Error('HTTP response exceeds 1 MB'));
                });
                res.on('aborted', () => req.destroy(new Error('HTTP response aborted')));
                res.on('error', error => req.destroy(error));
                res.on('end', () => {
                    clearTimeout(timer);
                    if (res.statusCode >= 200 && res.statusCode < 300 && !body.includes('Microsoft Teams endpoint returned HTTP error 429')) {
                        resolve();
                    } else {
                        const error = new Error(`HTTP log delivery failed (${res.statusCode})`);
                        error.retryable = res.statusCode === 429 || res.statusCode >= 500 || body.includes('HTTP error 429');
                        const retryAfter = res.headers['retry-after'];
                        if (retryAfter) {
                            const ms = Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
                            if (Number.isFinite(ms)) error.retryAfter = Math.min(Math.max(0, ms), MAX_RETRY_WAIT_MS);
                        }
                        reject(error);
                    }
                });
            });
            timer = setTimeout(() => req.destroy(new Error('HTTP log delivery timed out')), this.timeout);
            req.on('error', error => { clearTimeout(timer); reject(error); });
            req.end(payload);
        });
    }

    async flush() {
        await Promise.allSettled([...this.pending]);
        if (this.failure) {
            const error = this.failure;
            this.failure = null;
            throw error;
        }
    }
}

module.exports = { HttpDelivery };
