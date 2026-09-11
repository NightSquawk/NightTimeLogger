/**
 * @file /lib/secretRedaction.js
 * @description Reusable, dependency-free secret redaction for log records.
 *
 * Two complementary mechanisms:
 *   1. Key matching  - a value is replaced wholesale when its *key name* looks
 *                      like a credential (case-insensitive, `-`/`_` agnostic).
 *   2. Pattern match - well-known secret shapes are replaced inside string
 *                      values and free-form message text.
 *
 * Design constraints (this runs on every single log call):
 *   - Never throws. A failure degrades to the replacement token.
 *   - Never mutates the input; `redactObject()` always returns a fresh copy.
 *   - No JSON.stringify/parse round trip, no external dependencies.
 *   - Allocation-conscious: a cheap combined "prefilter" regex rejects strings
 *     that cannot possibly contain a known secret, so the common case runs one
 *     regex test instead of a dozen full scans.
 *
 * Intentionally conservative on patterns: a false negative leaves a secret in
 * place (no worse than having no redaction), while an over-eager pattern
 * mangles ordinary log text and destroys the forensic value of the log.
 */

'use strict';

/** Token substituted for redacted values. */
const REDACTED = '[REDACTED]';

/** Substituted for a value that is an ancestor of itself. */
const CIRCULAR = '[Circular]';

/** Substituted for a property whose getter threw. */
const UNREADABLE = '[Unreadable]';

/** Substituted for containers below `maxDepth`. */
const DEPTH_LIMIT = '[Object]';

/** Appended to strings clipped at `maxStringLength`. */
const TRUNCATED_MARKER = '...[truncated]';

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_STRING_LENGTH = 16384;

/** Upper bound on the per-redactor key-normalisation memo, so hostile/random keys cannot grow it forever. */
const KEY_CACHE_LIMIT = 512;

/**
 * Key names whose *values* are replaced wholesale.
 *
 * Matched after lowercasing and stripping `-` and `_`, so `X-API-Key`,
 * `api_key` and `apikey` are all the same entry.
 *
 * Deliberately excludes generic context identifiers (sessionId, userId,
 * tenantId, correlationId, traceId, requestId): those are log context that
 * makes logs useful, not credentials.
 */
const DEFAULT_KEYS = Object.freeze([
    'password',
    'passwd',
    'pass',
    'pwd',
    'secret',
    'token',
    'apikey',
    'api_key',
    'x-api-key',
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-device-installation-secret',
    'installationsecret',
    'privatekey',
    'private_key',
    'clientsecret',
    'client_secret',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'idtoken',
    'id_token',
    'sessiontoken',
    'credential',
    'credentials',
    // Discord/Teams webhook URLs embed their auth token in the path.
    'webhookurl',
    'snmpcommunity',
    'community_string',
]);

/*
 * Pattern conventions
 * -------------------
 * Every pattern is global. A pattern may declare two *named* capture groups:
 *   `pre`  - text kept in front of the replacement (e.g. the key and separator)
 *   `post` - text kept after the replacement (e.g. the `@` of a URL userinfo)
 * Anything else the pattern matches is replaced. Patterns without named groups
 * have their whole match replaced.
 *
 * No pattern nests unbounded quantifiers, so none can backtrack catastrophically.
 */

/** PEM private key block (RSA/EC/DSA/OpenSSH/generic). Run first: it spans lines. */
const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g;

/** AWS access key id - fixed, unambiguous shape. */
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;

/** JWT - three base64url segments joined by dots, with the near-universal `eyJ` header prefix. */
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;

/** GitHub personal/OAuth/app/refresh tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`) and fine-grained PATs. */
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;

/** Slack tokens - `xoxb-`, `xoxa-`, `xoxp-`, `xoxo-`, `xoxr-`, `xoxs-`. */
const SLACK_TOKEN = /\bxox[abpors]-[A-Za-z0-9-]{10,}/gi;

/** Stripe secret/restricted keys and webhook signing secrets. */
const STRIPE_KEY = /\b(?:[sr]k_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,})/g;

/** `Authorization: Bearer <token>` - anywhere in the line, not just in a header. */
const BEARER_TOKEN = /(?<pre>\bBearer\s+)[A-Za-z0-9\-._~+/]{8,}={0,2}/gi;

/**
 * `Authorization: Basic <base64>`.
 * Requires >=16 base64 chars and at least one uppercase/digit so ordinary prose
 * ("Basic authentication is required") is not mistaken for credentials.
 */
const BASIC_AUTH = /(?<pre>\bBasic\s+)(?=[A-Za-z0-9+/]*[A-Z0-9])[A-Za-z0-9+/]{16,}={0,2}/g;

/** Discord webhook URL - keeps the id, redacts only the token segment. */
const DISCORD_WEBHOOK = /(?<pre>https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/)[A-Za-z0-9_-]+/gi;

/** Credentials embedded in a URL (`scheme://user:password@host`) - redacts only the password. */
const URL_CREDENTIALS = /(?<pre>\b[a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]*:)[^\s/?#@]+(?<post>@)/gi;

/** `key=value` / `key: "value"` for secret-shaped field names, loose value charset. */
const KV_SECRET = /(?<pre>\b(?:api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|secret[_-]?key|client[_-]?secret|password|passwd|pwd|auth[_-]?token|private[_-]?key|token|secret)\s*[:=]\s*["']?)[^\s'",;]{4,}/gi;

/**
 * Generic `key=value` fallback that keeps the key and redacts the rest of the
 * token. Catches short values that KV_SECRET's 4-char minimum skips. The
 * lookahead avoids re-redacting a value another pattern already replaced.
 */
const GENERIC_KV = /(?<pre>\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)(?!["'[])\S+/gi;

/** Default pattern set, in application order. */
const DEFAULT_PATTERNS = Object.freeze([
    PEM_PRIVATE_KEY,
    AWS_ACCESS_KEY,
    JWT,
    GITHUB_TOKEN,
    SLACK_TOKEN,
    STRIPE_KEY,
    BEARER_TOKEN,
    BASIC_AUTH,
    DISCORD_WEBHOOK,
    KV_SECRET,
    GENERIC_KV,
    URL_CREDENTIALS,
]);

/**
 * Cheap substring hints, one per default pattern. A hint MUST be a superset of
 * everything its pattern can match: if the combined hint regex does not match a
 * string, the pattern provably cannot either, so the scan is skipped.
 * User-supplied patterns have no hint and therefore always run.
 */
const PATTERN_HINTS = new Map([
    [PEM_PRIVATE_KEY, '-----begin'],
    [AWS_ACCESS_KEY, 'akia'],
    [JWT, 'eyj'],
    [GITHUB_TOKEN, 'gh[pousr]_|github_pat_'],
    [SLACK_TOKEN, 'xox'],
    [STRIPE_KEY, '[sr]k_|whsec_'],
    [BEARER_TOKEN, 'bearer'],
    [BASIC_AUTH, 'basic'],
    [DISCORD_WEBHOOK, 'discord'],
    [KV_SECRET, 'key|secret|passw|pwd|token'],
    [GENERIC_KV, 'key|secret|passw|token'],
    [URL_CREDENTIALS, '://'],
]);

let hasWarned = false;

/**
 * Emit at most one process warning for the lifetime of the process.
 * @param {Error} err - The swallowed error.
 */
function warnOnce(err) {
    if (hasWarned) {
        return;
    }
    hasWarned = true;
    try {
        process.emitWarning(
            'secret redaction failed, value replaced: ' + ((err && err.message) || err),
            'NTLoggerRedactionWarning'
        );
    } catch (_ignored) {
        // Warning is best-effort; never let it escape.
    }
}

/**
 * Lowercase a key and strip `-`/`_` so `X-API-Key`, `api_key` and `apikey` unify.
 * @param {string} key - Raw key name.
 * @returns {string} - Normalized key name.
 */
function normalizeKey(key) {
    const lower = key.toLowerCase();
    if (lower.indexOf('-') === -1 && lower.indexOf('_') === -1) {
        return lower;
    }
    let out = '';
    for (let i = 0; i < lower.length; i++) {
        const ch = lower[i];
        if (ch !== '-' && ch !== '_') {
            out += ch;
        }
    }
    return out;
}

/**
 * Clone a regex we own, forcing the global flag so `replace` covers every match
 * and so a caller's regex never has its `lastIndex` mutated by us.
 * @param {RegExp} re - Source regex.
 * @returns {RegExp} - Owned, global clone.
 */
function toOwnedGlobal(re) {
    let flags = re.flags;
    if (flags.indexOf('g') === -1) {
        flags += 'g';
    }
    return new RegExp(re.source, flags);
}

/**
 * Best-effort string conversion that never throws.
 * @param {*} value - Any value.
 * @returns {string} - Stringified value.
 */
function safeToString(value) {
    try {
        return String(value);
    } catch (_ignored) {
        return UNREADABLE;
    }
}

/**
 * Create a redactor bound to a configuration.
 *
 * @param {object} [options] - Redactor options.
 * @param {string[]|false} [options.keys] - Key names whose values are replaced. `false` disables key matching.
 * @param {string[]} [options.extraKeys] - Additional key names appended to `keys`.
 * @param {RegExp[]|false} [options.patterns] - Patterns applied to string values. `false` disables pattern matching.
 * @param {RegExp[]} [options.extraPatterns] - Additional patterns appended to `patterns`.
 * @param {string} [options.replacement] - Replacement token. Defaults to `[REDACTED]`.
 * @param {number} [options.maxDepth] - Maximum container depth. Defaults to 8.
 * @param {number} [options.maxStringLength] - Maximum scanned/kept string length. Defaults to 16384.
 * @returns {{redactString: Function, redactObject: Function, redact: Function, isSensitiveKey: Function}} - Redactor.
 */
function createRedactor(options) {
    const opts = options || {};

    const replacement = typeof opts.replacement === 'string' ? opts.replacement : REDACTED;

    const maxDepth = Number.isFinite(opts.maxDepth) && opts.maxDepth >= 0
        ? Math.floor(opts.maxDepth)
        : DEFAULT_MAX_DEPTH;

    const maxStringLength = Number.isFinite(opts.maxStringLength) && opts.maxStringLength >= 0
        ? Math.floor(opts.maxStringLength)
        : DEFAULT_MAX_STRING_LENGTH;

    // ---- keys -------------------------------------------------------------
    let keyList;
    if (opts.keys === false) {
        keyList = [];
    } else if (Array.isArray(opts.keys)) {
        keyList = opts.keys;
    } else {
        keyList = DEFAULT_KEYS;
    }
    if (Array.isArray(opts.extraKeys) && opts.extraKeys.length > 0) {
        keyList = keyList.concat(opts.extraKeys);
    }

    const keySet = new Set();
    for (let i = 0; i < keyList.length; i++) {
        if (typeof keyList[i] === 'string' && keyList[i].length > 0) {
            keySet.add(normalizeKey(keyList[i]));
        }
    }
    const hasKeys = keySet.size > 0;
    const keyCache = new Map();

    // ---- patterns ---------------------------------------------------------
    let patternList;
    if (opts.patterns === false) {
        patternList = [];
    } else if (Array.isArray(opts.patterns)) {
        patternList = opts.patterns;
    } else {
        patternList = DEFAULT_PATTERNS;
    }
    if (Array.isArray(opts.extraPatterns) && opts.extraPatterns.length > 0) {
        patternList = patternList.concat(opts.extraPatterns);
    }

    // Ordered list of { re, hinted }. Hinted entries are skipped when the
    // combined prefilter misses; order is otherwise preserved exactly.
    const prepared = [];
    const hintSources = [];
    let unhintedCount = 0;
    for (let i = 0; i < patternList.length; i++) {
        const source = patternList[i];
        if (!(source instanceof RegExp)) {
            continue;
        }
        const hint = PATTERN_HINTS.get(source);
        if (hint) {
            hintSources.push(hint);
        } else {
            unhintedCount++;
        }
        prepared.push({ re: toOwnedGlobal(source), hinted: Boolean(hint) });
    }
    const hasPatterns = prepared.length > 0;
    // Non-global on purpose: `test()` on a global regex would advance lastIndex.
    const prefilter = hintSources.length > 0 ? new RegExp(hintSources.join('|'), 'i') : null;
    const alwaysScan = unhintedCount > 0 || prefilter === null;

    /**
     * Replacement callback preserving the optional `pre`/`post` named groups.
     * @returns {string} - Replacement text.
     */
    function replacer() {
        const last = arguments[arguments.length - 1];
        if (last !== null && typeof last === 'object') {
            const pre = last.pre === undefined ? '' : last.pre;
            const post = last.post === undefined ? '' : last.post;
            return pre + replacement + post;
        }
        return replacement;
    }

    /**
     * Test whether a key name denotes a secret.
     * @param {string} key - Key name.
     * @returns {boolean} - True when the key's value must be replaced.
     */
    function isSensitiveKey(key) {
        if (!hasKeys || typeof key !== 'string' || key.length === 0) {
            return false;
        }
        const cached = keyCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        let result = false;
        try {
            result = keySet.has(normalizeKey(key));
        } catch (err) {
            warnOnce(err);
        }
        if (keyCache.size < KEY_CACHE_LIMIT) {
            keyCache.set(key, result);
        }
        return result;
    }

    /**
     * Apply the pattern set to a string. Strings longer than `maxStringLength`
     * are scanned up to that length and then truncated with a marker.
     * @param {*} value - Candidate string (non-strings are returned untouched).
     * @returns {*} - Redacted string.
     */
    function redactString(value) {
        if (typeof value !== 'string' || value.length === 0) {
            return value;
        }
        try {
            let text = value;
            let truncated = false;
            if (text.length > maxStringLength) {
                text = text.slice(0, maxStringLength);
                truncated = true;
            }

            if (hasPatterns) {
                const runHinted = alwaysScan || (prefilter !== null && prefilter.test(text));
                for (let i = 0; i < prepared.length; i++) {
                    const entry = prepared[i];
                    if (entry.hinted && !runHinted) {
                        continue;
                    }
                    entry.re.lastIndex = 0;
                    text = text.replace(entry.re, replacer);
                    entry.re.lastIndex = 0;
                }
            }

            if (truncated) {
                return text + TRUNCATED_MARKER;
            }
            return text;
        } catch (err) {
            warnOnce(err);
            return replacement;
        }
    }

    /**
     * Read a property without letting a throwing getter escape.
     * @param {object} target - Object to read from.
     * @param {string} key - Property name.
     * @returns {{ok: boolean, value: *}} - Read outcome.
     */
    function readProperty(target, key) {
        try {
            return { ok: true, value: target[key] };
        } catch (_ignored) {
            return { ok: false, value: undefined };
        }
    }

    /**
     * Assign one key onto the output object, honouring key matching.
     * @param {object} out - Destination object.
     * @param {object} source - Source object.
     * @param {string} key - Property name.
     * @param {number} depth - Current depth.
     * @param {Set} seen - Ancestor set.
     */
    function assignKey(out, source, key, depth, seen) {
        const read = readProperty(source, key);
        if (!read.ok) {
            out[key] = UNREADABLE;
            return;
        }
        const value = read.value;
        if (hasKeys && isSensitiveKey(key)) {
            // Matched keys are replaced regardless of value type, but empty
            // slots stay empty so "absent" is not confused with "hidden".
            out[key] = value === null || value === undefined ? value : replacement;
            return;
        }
        out[key] = walk(value, depth + 1, seen);
    }

    /**
     * Convert an Error into a plain, redacted object without losing the stack.
     * @param {Error} err - Error instance.
     * @param {number} depth - Current depth.
     * @param {Set} seen - Ancestor set.
     * @returns {object} - Plain object form.
     */
    function walkError(err, depth, seen) {
        const out = {};
        out.name = safeToString(err.name === undefined ? 'Error' : err.name);
        out.message = redactString(safeToString(err.message));
        const stack = readProperty(err, 'stack');
        if (stack.ok && stack.value !== undefined && stack.value !== null) {
            out.stack = redactString(safeToString(stack.value));
        }

        const keys = Object.keys(err);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') {
                continue;
            }
            assignKey(out, err, key, depth, seen);
        }

        // `code` and `cause` are frequently non-enumerable; keep them anyway.
        if (out.code === undefined) {
            const code = readProperty(err, 'code');
            if (code.ok && code.value !== undefined) {
                out.code = walk(code.value, depth + 1, seen);
            }
        }
        const cause = readProperty(err, 'cause');
        if (cause.ok && cause.value !== undefined) {
            out.cause = walk(cause.value, depth + 1, seen);
        }
        return out;
    }

    /**
     * Recursive copy-and-redact.
     * @param {*} value - Value to redact.
     * @param {number} depth - Current depth.
     * @param {Set} seen - Set of ancestors on the current path.
     * @returns {*} - Redacted copy.
     */
    function walk(value, depth, seen) {
        if (value === null || value === undefined) {
            return value;
        }

        const type = typeof value;
        if (type === 'string') {
            return redactString(value);
        }
        if (type === 'number' || type === 'boolean' || type === 'bigint') {
            return value;
        }
        if (type === 'symbol') {
            return safeToString(value);
        }
        if (type === 'function') {
            return '[Function' + (value.name ? ': ' + value.name : '') + ']';
        }

        if (depth >= maxDepth) {
            return DEPTH_LIMIT;
        }
        if (seen.has(value)) {
            return CIRCULAR;
        }

        // Fast path: ordinary object literals and null-prototype bags.
        const proto = Object.getPrototypeOf(value);
        if (proto === Object.prototype || proto === null) {
            const out = {};
            seen.add(value);
            try {
                const keys = Object.keys(value);
                for (let i = 0; i < keys.length; i++) {
                    assignKey(out, value, keys[i], depth, seen);
                }
            } finally {
                seen.delete(value);
            }
            return out;
        }

        if (Array.isArray(value)) {
            const out = new Array(value.length);
            seen.add(value);
            try {
                for (let i = 0; i < value.length; i++) {
                    out[i] = walk(value[i], depth + 1, seen);
                }
            } finally {
                seen.delete(value);
            }
            return out;
        }

        if (value instanceof Date) {
            try {
                return value.toISOString();
            } catch (_ignored) {
                return 'Invalid Date';
            }
        }
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
            // Never dump bytes: buffers routinely hold key material.
            return '[Buffer ' + value.length + ' bytes]';
        }
        if (value instanceof RegExp) {
            return safeToString(value);
        }
        if (value instanceof Error) {
            seen.add(value);
            try {
                return walkError(value, depth, seen);
            } finally {
                seen.delete(value);
            }
        }
        if (value instanceof Map) {
            const out = {};
            seen.add(value);
            try {
                for (const entry of value) {
                    const key = typeof entry[0] === 'string' ? entry[0] : safeToString(entry[0]);
                    if (hasKeys && isSensitiveKey(key)) {
                        out[key] = entry[1] === null || entry[1] === undefined ? entry[1] : replacement;
                    } else {
                        out[key] = walk(entry[1], depth + 1, seen);
                    }
                }
            } catch (err) {
                warnOnce(err);
            } finally {
                seen.delete(value);
            }
            return out;
        }
        if (value instanceof Set) {
            const out = [];
            seen.add(value);
            try {
                for (const item of value) {
                    out.push(walk(item, depth + 1, seen));
                }
            } catch (err) {
                warnOnce(err);
            } finally {
                seen.delete(value);
            }
            return out;
        }
        if (ArrayBuffer.isView(value)) {
            return '[' + (value.constructor && value.constructor.name ? value.constructor.name : 'TypedArray')
                + ' ' + value.byteLength + ' bytes]';
        }
        if (value instanceof ArrayBuffer) {
            return '[ArrayBuffer ' + value.byteLength + ' bytes]';
        }

        // Class instances and anything exotic: walk own enumerable props.
        const out = {};
        seen.add(value);
        try {
            const keys = Object.keys(value);
            for (let i = 0; i < keys.length; i++) {
                assignKey(out, value, keys[i], depth, seen);
            }
        } catch (err) {
            warnOnce(err);
        } finally {
            seen.delete(value);
        }
        return out;
    }

    /**
     * Deep copy `value`, redacting sensitive keys and secret-shaped strings.
     * Never mutates the input and never throws.
     * @param {*} value - Value to redact.
     * @returns {*} - Redacted copy.
     */
    function redactObject(value) {
        try {
            return walk(value, 0, new Set());
        } catch (err) {
            warnOnce(err);
            return replacement;
        }
    }

    /**
     * Redact any value, dispatching on its type.
     * @param {*} value - Value to redact.
     * @returns {*} - Redacted value.
     */
    function redact(value) {
        if (typeof value === 'string') {
            return redactString(value);
        }
        return redactObject(value);
    }

    return {
        redactString,
        redactObject,
        redact,
        isSensitiveKey,
    };
}

module.exports = {
    createRedactor,
    DEFAULT_KEYS,
    DEFAULT_PATTERNS,
    REDACTED,
};
