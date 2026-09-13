'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();

function withSecretValues(values, callback) {
    if (!Array.isArray(values) || values.some(v => typeof v !== 'string' || !v)) {
        throw new TypeError('Secret values must be nonempty strings');
    }
    const secrets = [...new Set([...(scope.getStore() || []), ...values])];
    if (secrets.length > 128 || secrets.some(v => v.length > 65536)) {
        throw new RangeError('Secret scope exceeds 128 values or 65536 characters per value');
    }
    return scope.run(secrets, callback);
}
function redactSecretValues(text, replacement) {
    const secrets = scope.getStore();
    if (!secrets?.length) return text;
    const variants = [...new Set(secrets.flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))]
        .sort((a, b) => b.length - a.length);
    // A single pass avoids redacting the replacement itself or missing overlaps.
    const pattern = new RegExp([replacement, ...variants].map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    return text.replace(pattern, () => replacement);
}
module.exports = { withSecretValues, redactSecretValues, hasSecretValues: () => Boolean(scope.getStore()?.length) };
