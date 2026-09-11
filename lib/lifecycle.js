'use strict';

const delay = () => new Promise(resolve => setTimeout(resolve, 1));

function withTimeout(operation, timeout, label) {
    let timer;
    return Promise.race([
        operation,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
        }),
    ]).finally(() => clearTimeout(timer));
}

// Winston uses readable-stream, so inspect both its buffers and file sinks.
function busy(stream) {
    return !!(stream && (stream._writableState?.length || stream._readableState?.length));
}

async function drain(logger, state, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (state.pending || busy(logger) || logger.transports.some(t =>
        busy(t) || busy(t._stream) || busy(t._dest) || t._opening || t._rotate)) {
        if (state.error) throw state.error;
        if (Date.now() >= deadline) throw new Error('Logger drain timed out');
        await delay();
    }
    if (state.error) throw state.error;
}

// Winston calls close on unpipe but doesn't await the result. Retain that promise.
function trackClose(transport) {
    if (transport._ntlClose) return;
    const close = transport.close?.bind(transport);
    let promise;
    transport._ntlClose = () => {
        if (!promise) {
            // File._final already ended and drained this stream before unpipe.
            // Calling File.close(callback) on that finished stream never calls back.
            if (transport instanceof require('winston').transports.File && transport._stream?._writableState.finished) {
                return (promise = Promise.resolve());
            }
            promise = close && close.length > 0
                ? new Promise((resolve, reject) => close(err => err ? reject(err) : resolve()))
                : Promise.resolve().then(() => close?.());
            promise.catch(() => {}); // unpipe cannot consume a rejected promise
        }
        return promise;
    };
    transport.close = transport._ntlClose;
}

module.exports = { withTimeout, drain, trackClose };
