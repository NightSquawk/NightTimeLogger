'use strict';

// Standard "log fatal, bounded drain, exit" process handlers for Pino (and any
// generic) logger. Winston users already have lib/signalHandler.js; this module
// deliberately has no Winston dependency so it can ship with ntlogger/pino.
//
// Explicit opt-in: importing a library must not install process exit handlers,
// so nothing here runs until installProcessHandlers() is called.

const { inspect } = require('util');

const DEFAULT_TIMEOUT = 4000;
const DEFAULT_SIGNALS = ['SIGTERM', 'SIGINT'];

// POSIX signal numbers for the 128+n force-exit convention.
const SIGNAL_NUMBERS = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGABRT: 6,
    SIGUSR1: 10,
    SIGUSR2: 12,
    SIGTERM: 15,
    SIGBREAK: 21,
};

// One entry per logger so a double install is a no-op (see installProcessHandlers).
const registry = new WeakMap();

function isPromise(value) {
    return !!value && typeof value.then === 'function';
}

function unref(timer) {
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
}

// Pino puts Symbol('pino.*') properties on every logger and child logger.
function isPinoLogger(logger) {
    if (!logger || typeof logger !== 'object') return false;
    for (let target = logger; target; target = Object.getPrototypeOf(target)) {
        for (const symbol of Object.getOwnPropertySymbols(target)) {
            if (typeof symbol.description === 'string' && symbol.description.startsWith('pino.')) return true;
        }
    }
    return typeof logger.bindings === 'function' && typeof logger.child === 'function';
}

// unhandledRejection hands us whatever was thrown — strings, numbers, plain
// objects. Downstream serializers expect Error-likes, so normalize.
function toError(value) {
    if (value instanceof Error) return value;
    if (value && typeof value === 'object' && typeof value.message === 'string' && typeof value.stack === 'string') {
        return value;
    }
    let description;
    try {
        description = typeof value === 'string' ? value : inspect(value, { depth: 2, breakLength: Infinity });
    } catch (error) {
        description = Object.prototype.toString.call(value);
    }
    const normalized = new Error(description);
    normalized.name = 'NonErrorRejection';
    normalized.reason = value;
    return normalized;
}

/**
 * Flush whatever the logger supports, bounded by `timeout`. Never rejects.
 *
 * Resolution order:
 *   1. logger.flush(cb)      — Pino v7+ (callback signature, flush.length >= 1)
 *   2. logger.flush()        — ntlogger's Winston logger (returns a Promise)
 *   3. logger.close()        — last resort, when only close() exists
 *   4. setImmediate          — nothing to flush, yield one turn and resolve
 *
 * @param {object} logger
 * @param {number} [timeout=5000] milliseconds; <= 0 means "no budget left"
 * @returns {Promise<{drained: boolean, error?: Error}>}
 */
function drainLogger(logger, timeout = 5000) {
    const budget = typeof timeout === 'number' && isFinite(timeout) ? timeout : 5000;
    if (budget <= 0) {
        return Promise.resolve({ drained: false, error: new Error('Logger drain budget exhausted') });
    }

    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = unref(setTimeout(
            () => finish({ drained: false, error: new Error(`Logger drain timed out after ${budget}ms`) }),
            budget,
        ));

        const settleWith = value => {
            if (isPromise(value)) {
                value.then(() => finish({ drained: true }), error => finish({ drained: false, error }));
            } else {
                finish({ drained: true });
            }
        };

        try {
            if (logger && typeof logger.flush === 'function') {
                if (logger.flush.length >= 1) {
                    // Pino: the callback fires once the destination has flushed.
                    logger.flush(error => (error ? finish({ drained: false, error }) : finish({ drained: true })));
                    return;
                }
                settleWith(logger.flush());
                return;
            }
            if (logger && typeof logger.close === 'function') {
                settleWith(logger.close());
                return;
            }
            setImmediate(() => finish({ drained: true }));
        } catch (error) {
            finish({ drained: false, error });
        }
    });
}

/**
 * Install uncaughtException / unhandledRejection / signal handlers that log,
 * run a user shutdown hook, drain the logger, and exit — all under one budget.
 *
 * Installing twice for the same logger returns the first uninstall function and
 * registers nothing new; the options from the first call keep winning.
 *
 * @param {object} logger any logger with level methods (Pino, ntlogger, console-like)
 * @param {object} [options]
 * @returns {function(): void} uninstall — removes only this call's listeners, idempotent
 */
function installProcessHandlers(logger, options = {}) {
    const canCache = !!logger && (typeof logger === 'object' || typeof logger === 'function');
    if (canCache && registry.has(logger)) return registry.get(logger);

    const {
        timeout = DEFAULT_TIMEOUT,
        signals = DEFAULT_SIGNALS,
        exitOnSignal = true,
        signalExitCode = 0,
        uncaughtExitCode = 1,
        exitOnUnhandledRejection = false,
        unhandledRejectionLevel = 'error',
        onShutdown,
        proc = process,
        logPrefix,
    } = options;

    const exit = options.exit
        || (typeof proc.exit === 'function' ? proc.exit.bind(proc) : process.exit.bind(process));

    const prefix = typeof logPrefix === 'string' && logPrefix.length ? `${logPrefix} ` : '';

    let shuttingDown = false;
    let exited = false;

    const doExit = code => {
        if (exited) return;
        exited = true;
        try {
            exit(code);
        } catch (error) {
            try {
                console.error('[ntlogger] process exit failed:', error);
            } catch (ignored) { /* nothing left to do */ }
        }
    };

    // The logger is the thing that may be broken, so every call is guarded and
    // console.error is the single fallback.
    const safeLog = (level, meta, message) => {
        const text = `${prefix}${message}`;
        const method = typeof logger?.[level] === 'function'
            ? level
            : (typeof logger?.error === 'function' ? 'error' : null);
        if (method) {
            try {
                if (isPinoLogger(logger)) logger[method](meta, text);
                else logger[method](text, meta);
                return;
            } catch (error) { /* fall through to console.error exactly once */ }
        }
        try {
            console.error(text, meta);
        } catch (ignored) { /* nothing left to do */ }
    };

    // Resolves instead of rejecting so the shutdown path never branches on throw.
    const runHook = (reason, budget) => new Promise(resolve => {
        if (typeof onShutdown !== 'function') return resolve();
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve();
        };
        const timer = unref(setTimeout(() => {
            if (done) return;
            safeLog('warn', { reason, timeout: budget }, `Shutdown hook timed out after ${budget}ms`);
            finish();
        }, budget > 0 ? budget : 1));
        let result;
        try {
            result = onShutdown(reason);
        } catch (error) {
            safeLog('error', { err: error, reason }, 'Shutdown hook failed');
            return finish();
        }
        if (!isPromise(result)) return finish();
        result.then(finish, error => {
            safeLog('error', { err: error, reason }, 'Shutdown hook failed');
            finish();
        });
    });

    const runShutdown = (reason, exitCode, shouldExit) => {
        shuttingDown = true;
        const deadline = Date.now() + timeout;
        // Hard backstop: a wedged hook or an unflushable logger must not pin the
        // process past the supervisor's grace window. unref'd so it never keeps
        // an otherwise-idle event loop alive on its own.
        const forceTimer = shouldExit
            ? unref(setTimeout(() => doExit(exitCode), timeout))
            : null;

        return (async () => {
            await runHook(reason, Math.max(0, deadline - Date.now()));
            const result = await drainLogger(logger, deadline - Date.now());
            if (!result.drained && result.error) {
                try {
                    console.error(`[ntlogger] logger drain incomplete during ${reason}:`, result.error.message);
                } catch (ignored) { /* nothing left to do */ }
            }
            if (forceTimer) clearTimeout(forceTimer);
            if (shouldExit) doExit(exitCode);
        })();
    };

    const onUncaughtException = (err, origin) => {
        if (shuttingDown) {
            safeLog('fatal', { err, origin }, 'Uncaught exception during shutdown, already exiting');
            return;
        }
        safeLog('fatal', { err, origin }, 'Uncaught exception');
        void runShutdown('uncaughtException', uncaughtExitCode, true);
    };

    const onUnhandledRejection = reason => {
        const err = toError(reason);
        if (shuttingDown) {
            safeLog(unhandledRejectionLevel, { err }, 'Unhandled promise rejection during shutdown, already exiting');
            return;
        }
        safeLog(unhandledRejectionLevel, { err }, 'Unhandled promise rejection');
        if (!exitOnUnhandledRejection) return;
        void runShutdown('unhandledRejection', uncaughtExitCode, true);
    };

    const makeSignalHandler = signal => () => {
        if (shuttingDown) {
            // Second Ctrl-C / second SIGTERM: the operator wants out now.
            safeLog('warn', { signal }, `Received ${signal} during shutdown, forcing exit`);
            doExit(128 + (SIGNAL_NUMBERS[signal] || 0));
            return;
        }
        safeLog('info', { signal }, `Received ${signal}, shutting down`);
        void runShutdown(signal, signalExitCode, exitOnSignal);
    };

    const listeners = [
        ['uncaughtException', onUncaughtException],
        ['unhandledRejection', onUnhandledRejection],
    ];
    for (const signal of Array.isArray(signals) ? signals : []) {
        listeners.push([signal, makeSignalHandler(signal)]);
    }
    for (const [event, handler] of listeners) proc.on(event, handler);

    let removed = false;
    const uninstall = () => {
        if (removed) return;
        removed = true;
        for (const [event, handler] of listeners) {
            if (typeof proc.off === 'function') proc.off(event, handler);
            else if (typeof proc.removeListener === 'function') proc.removeListener(event, handler);
        }
        listeners.length = 0;
        if (canCache && registry.get(logger) === uninstall) registry.delete(logger);
    };

    if (canCache) registry.set(logger, uninstall);
    return uninstall;
}

module.exports = { installProcessHandlers, drainLogger };
