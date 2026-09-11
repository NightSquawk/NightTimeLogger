'use strict';

/**
 * @file /lib/pinoHooks.js
 * @description Pino adapter that exposes NightTimeLogger's sampling, rate limiting and
 *              deduplication features (lib/logSampler.js, lib/logDeduplicator.js) through a
 *              Pino `hooks.logMethod` implementation.
 *
 * The Winston path applies these features inside the wrapped log method
 * (see lib/logger.js -> wrapLoggerMethod). Pino has no such wrapper, but it does expose
 * `hooks.logMethod(inputArgs, method, level)` which is invoked *before* the log line is
 * serialized. That is the correct place to drop, pass through, or rewrite a log call.
 *
 * Usage:
 *     const { createPinoFeatures } = require('./lib/pinoHooks')  // internal module, wired up by pino.js createLogger();
 *     const features = createPinoFeatures({ sampling, rateLimit, deduplication });
 *     const logger = pino(features.enabled ? { hooks: { logMethod: features.logMethod } } : {});
 */

const { LogSampler } = require('./logSampler');
const { LogDeduplicator } = require('./logDeduplicator');
const NTL_LEVELS = require('./levels');

/**
 * Pino's standard numeric levels mapped to NightTimeLogger level names.
 * NTL has no numeric equivalent for `internal`; custom levels are resolved by name
 * through the `levels` option (pino's `logger.levels.values`).
 * @type {Readonly<Object<number, string>>}
 */
const PINO_LEVEL_TO_NTL = Object.freeze({
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
});

/** Maximum number of interpolation arguments folded into a dedup fingerprint. */
const MAX_FINGERPRINT_ARGS = 8;

/**
 * Check whether a value is a plain-ish object (merge object candidate).
 * @param {*} value - Value to test
 * @returns {boolean} - True when the value can act as a Pino merge object
 */
function isMergeObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Error);
}

/**
 * Normalize the `sampling` option into a plain level -> rate map.
 * @param {object} sampling - Raw sampling config
 * @returns {object} - Sanitized sampling map
 */
function normalizeSampling(sampling) {
    const out = {};
    if (!sampling || typeof sampling !== 'object') {
        return out;
    }
    for (const [level, rate] of Object.entries(sampling)) {
        if (typeof rate === 'number' && Number.isFinite(rate)) {
            out[level] = rate;
        }
    }
    return out;
}

/**
 * Normalize the `rateLimit` option into a plain level -> { max, window } map.
 * Accepts `window` (documented) or `windowMs` (alias).
 * @param {object} rateLimit - Raw rate limit config
 * @returns {object} - Sanitized rate limit map
 */
function normalizeRateLimit(rateLimit) {
    const out = {};
    if (!rateLimit || typeof rateLimit !== 'object') {
        return out;
    }
    for (const [level, limit] of Object.entries(rateLimit)) {
        if (!limit || typeof limit !== 'object') {
            continue;
        }
        const max = typeof limit.max === 'number' ? limit.max : null;
        const window = typeof limit.window === 'number'
            ? limit.window
            : (typeof limit.windowMs === 'number' ? limit.windowMs : 60000);
        if (max === null || !Number.isFinite(max) || !Number.isFinite(window)) {
            continue;
        }
        out[level] = { max, window };
    }
    return out;
}

/**
 * Normalize the `deduplication` option.
 * Accepts `true`, or an object with `{ enabled, threshold, window | windowMs, levels }`.
 * @param {object|boolean} deduplication - Raw deduplication config
 * @returns {{enabled: boolean, threshold: number, window: number, levels: (string[]|null)}} - Sanitized config
 */
function normalizeDeduplication(deduplication) {
    const disabled = { enabled: false, threshold: 3, window: 60000, levels: null };

    if (deduplication === true) {
        return { enabled: true, threshold: 3, window: 60000, levels: null };
    }
    if (!deduplication || typeof deduplication !== 'object') {
        return disabled;
    }

    const keys = Object.keys(deduplication);
    if (keys.length === 0) {
        return disabled;
    }
    if (deduplication.enabled === false) {
        return disabled;
    }

    const window = typeof deduplication.window === 'number'
        ? deduplication.window
        : (typeof deduplication.windowMs === 'number' ? deduplication.windowMs : 60000);

    return {
        enabled: true,
        threshold: typeof deduplication.threshold === 'number' ? deduplication.threshold : 3,
        window,
        levels: Array.isArray(deduplication.levels) ? deduplication.levels.slice() : null,
    };
}

/**
 * Build a numeric -> NTL level name resolver.
 * Custom levels are resolved through the supplied pino `levels` map (name -> number);
 * unresolvable levels return null, which means "pass through unfiltered".
 * @param {object} levels - Pino `logger.levels.values` map (name -> number)
 * @returns {function(number): (string|null)} - Resolver function
 */
function createLevelResolver(levels) {
    const byNumber = {};

    if (levels && typeof levels === 'object') {
        for (const [name, value] of Object.entries(levels)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                byNumber[value] = name;
            }
        }
    }

    return function resolveLevel(levelValue) {
        if (typeof levelValue === 'string') {
            return levelValue;
        }
        if (typeof levelValue !== 'number' || !Number.isFinite(levelValue)) {
            return null;
        }
        const custom = byNumber[levelValue];
        if (typeof custom === 'string') {
            return custom;
        }
        const standard = PINO_LEVEL_TO_NTL[levelValue];
        return typeof standard === 'string' ? standard : null;
    };
}

/**
 * Locate the message argument inside the arguments Pino handed to `logMethod`.
 *
 * Supported shapes:
 *   (msg)                                  -> index 0
 *   (msg, ...interpolationArgs)            -> index 0
 *   (mergeObject, msg, ...args)            -> index 1
 *   (error)                                -> message from error, insert rewrite at index 1
 *   (mergeObject)                          -> no message
 *
 * @param {Array} inputArgs - Arguments Pino passed to the hook
 * @returns {{message: (string|null), index: number, insert: boolean, location: (string|null)}} - Extraction result
 */
function extractMessage(inputArgs) {
    const result = { message: null, index: -1, insert: false, location: null };

    if (!inputArgs || inputArgs.length === 0) {
        return result;
    }

    const first = inputArgs[0];

    if (typeof first === 'string') {
        result.message = first;
        result.index = 0;
        return result;
    }

    if (first instanceof Error) {
        // logger.error(err) -> pino uses err.message as msg. Rewriting means adding an
        // explicit msg argument, i.e. logger.error(err, 'boom (x3)').
        if (typeof inputArgs[1] === 'string') {
            result.message = inputArgs[1];
            result.index = 1;
        } else if (typeof first.message === 'string') {
            result.message = first.message;
            result.index = 1;
            result.insert = true;
        }
        return result;
    }

    if (isMergeObject(first)) {
        if (typeof first.module === 'string') {
            result.location = first.module;
        }
        if (typeof inputArgs[1] === 'string') {
            result.message = inputArgs[1];
            result.index = 1;
        }
        return result;
    }

    return result;
}

/**
 * Build the string used to fingerprint a log call. Primitive interpolation arguments are
 * folded in so that `info('user %s in', 'a')` and `info('user %s in', 'b')` stay distinct,
 * while lib/messageNormalizer.js still collapses varying ids/uuids/numbers.
 * Object arguments are reduced to a constant placeholder so nothing is retained.
 * @param {string} message - The message string
 * @param {Array} inputArgs - Arguments Pino passed to the hook
 * @param {number} messageIndex - Index of the message argument (or insert position)
 * @returns {string} - Fingerprint source string
 */
function buildFingerprintSource(message, inputArgs, messageIndex) {
    let source = message;
    const start = messageIndex + 1;
    const end = Math.min(inputArgs.length, start + MAX_FINGERPRINT_ARGS);

    for (let i = start; i < end; i++) {
        const arg = inputArgs[i];
        const type = typeof arg;
        if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
            source += ` ${String(arg)}`;
        } else if (arg === null || arg === undefined) {
            source += ' null';
        } else {
            source += ' [obj]';
        }
    }

    return source;
}

/**
 * Create the Pino feature adapter.
 *
 * @param {object} [options] - Options
 * @param {object} [options.sampling] - Per-level sampling rates, e.g. { debug: 0.1, info: 0.5 }
 * @param {object} [options.rateLimit] - Per-level rate limits, e.g. { info: { max: 100, window: 60000 } }
 * @param {object|boolean} [options.deduplication] - { enabled, threshold, window|windowMs, levels } or true
 * @param {object} [options.levels] - Pino `logger.levels.values` map (name -> number)
 * @param {string} [options.defaultLocation] - Fallback dedup location (mixin output is not in inputArgs)
 * @param {object} [options.sampler] - Pre-built sampler (primarily for testing)
 * @param {object} [options.deduplicator] - Pre-built deduplicator (primarily for testing)
 * @returns {object} - { enabled, logMethod, getStats, resetStats, destroy, sampler, deduplicator }
 */
function createPinoFeatures(options = {}) {
    const opts = options || {};

    const sampling = normalizeSampling(opts.sampling);
    const rateLimit = normalizeRateLimit(opts.rateLimit);
    const dedupConfig = normalizeDeduplication(opts.deduplication);

    const hasSamplerConfig = Object.keys(sampling).length > 0 || Object.keys(rateLimit).length > 0;

    const sampler = opts.sampler !== undefined && opts.sampler !== null
        ? opts.sampler
        : (hasSamplerConfig ? new LogSampler({ sampling, rateLimit }) : null);

    const deduplicator = opts.deduplicator !== undefined && opts.deduplicator !== null
        ? opts.deduplicator
        : (dedupConfig.enabled
            ? new LogDeduplicator({
                enabled: true,
                threshold: dedupConfig.threshold,
                window: dedupConfig.window,
            })
            : null);

    const defaultLocation = typeof opts.defaultLocation === 'string' ? opts.defaultLocation : null;
    const resolveLevel = createLevelResolver(opts.levels);

    // `fatal` is never dropped unless the configuration explicitly opts it in.
    const fatalSamplerExplicit = Object.prototype.hasOwnProperty.call(sampling, 'fatal')
        || Object.prototype.hasOwnProperty.call(rateLimit, 'fatal');
    // Opting fatal in requires either listing it in `deduplication.levels` or `deduplication.fatal: true`.
    const fatalDedupExplicit = (Array.isArray(dedupConfig.levels) && dedupConfig.levels.indexOf('fatal') !== -1)
        || Boolean(opts.deduplication && typeof opts.deduplication === 'object' && opts.deduplication.fatal === true);

    const dedupLevels = dedupConfig.levels;

    /**
     * Check whether deduplication applies to a level.
     * @param {string} level - NTL level name
     * @returns {boolean} - True when the level should be deduplicated
     */
    function dedupAppliesTo(level) {
        if (dedupLevels && dedupLevels.indexOf(level) === -1) {
            return false;
        }
        if (level === 'fatal' && !fatalDedupExplicit) {
            return false;
        }
        return true;
    }

    /**
     * Pino `hooks.logMethod` implementation.
     * MUST be invoked with `this` bound to the pino logger instance (Pino does this).
     * Never throws: any internal failure falls back to emitting the original log call.
     *
     * @param {Array} inputArgs - Arguments passed to the log method
     * @param {Function} method - The underlying pino log method
     * @param {number} level - Numeric pino level
     * @returns {*} - Result of the underlying log method, or undefined when dropped
     */
    function logMethod(inputArgs, method, level) {
        let emitted = false;

        try {
            const ntlLevel = resolveLevel(level);

            // Unknown/custom level that cannot be resolved: pass through unfiltered.
            if (ntlLevel === null) {
                emitted = true;
                return method.apply(this, inputArgs);
            }

            const isFatal = ntlLevel === 'fatal';

            // Rate limiting then sampling (LogSampler#shouldProcess applies them in that order).
            if (sampler && (!isFatal || fatalSamplerExplicit)) {
                if (sampler.shouldProcess(ntlLevel) === false) {
                    return undefined;
                }
            }

            // Deduplication.
            if (deduplicator && dedupAppliesTo(ntlLevel)) {
                const extracted = extractMessage(inputArgs);
                if (extracted.message !== null) {
                    const fingerprintSource = buildFingerprintSource(
                        extracted.message,
                        inputArgs,
                        extracted.insert ? extracted.index - 1 : extracted.index
                    );
                    // Meta is intentionally a fresh, tiny object: LogDeduplicator retains it as
                    // part of its entry sample, so no logged payload may be referenced here.
                    const decision = deduplicator.check(ntlLevel, fingerprintSource, {
                        location: extracted.location || defaultLocation || undefined,
                    });

                    if (decision) {
                        if (decision.shouldLog === false) {
                            return undefined;
                        }
                        if (decision.count > 1 && decision.message !== fingerprintSource) {
                            const suffix = decision.message.slice(fingerprintSource.length);
                            if (suffix) {
                                const newArgs = inputArgs.slice();
                                if (extracted.insert) {
                                    newArgs.splice(extracted.index, 0, extracted.message + suffix);
                                } else {
                                    newArgs[extracted.index] = extracted.message + suffix;
                                }
                                emitted = true;
                                return method.apply(this, newArgs);
                            }
                        }
                    }
                }
            }

            emitted = true;
            return method.apply(this, inputArgs);
        } catch (err) {
            if (emitted) {
                // The failure came from the log call itself; behave as if no hook was installed.
                throw err;
            }
            // A bug in the feature pipeline must never lose a log line.
            return method.apply(this, inputArgs);
        }
    }

    return {
        enabled: Boolean(sampler || deduplicator),
        sampler,
        deduplicator,
        logMethod,

        /**
         * Get feature statistics.
         * @returns {{sampling: (object|null), deduplication: (object|null)}} - Stats snapshot
         */
        getStats() {
            return {
                sampling: sampler && typeof sampler.getStats === 'function' ? sampler.getStats() : null,
                deduplication: deduplicator && typeof deduplicator.getStats === 'function'
                    ? deduplicator.getStats()
                    : null,
            };
        },

        /**
         * Reset feature statistics.
         * @returns {void}
         */
        resetStats() {
            if (sampler && typeof sampler.resetStats === 'function') {
                sampler.resetStats();
            }
            if (deduplicator && typeof deduplicator.resetStats === 'function') {
                deduplicator.resetStats();
            }
        },

        /**
         * Release timers and internal state so the process can exit cleanly.
         * @returns {void}
         */
        destroy() {
            if (sampler && typeof sampler.destroy === 'function') {
                sampler.destroy();
            }
            if (deduplicator && typeof deduplicator.destroy === 'function') {
                deduplicator.destroy();
            }
        },
    };
}

module.exports = {
    createPinoFeatures,
    PINO_LEVEL_TO_NTL,
    extractMessage,
    normalizeDeduplication,
};
