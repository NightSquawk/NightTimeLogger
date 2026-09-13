'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { withTimeout } = require('./lifecycle');

// Counts represent serialized records, not confirmed delivery to any destination.
function createLogObserver({ onLog, otel, onLogMaxPending = 100 } = {}) {
    if (onLog !== undefined && typeof onLog !== 'function') throw new TypeError('onLog must be a function');
    if (!Number.isSafeInteger(onLogMaxPending) || onLogMaxPending < 0) throw new TypeError('onLogMaxPending must be a nonnegative safe integer');
    const scope = new AsyncLocalStorage();
    const pending = new Set();
    const counts = Object.fromEntries(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'internal'].map(k => [k, 0]));
    let hookErrors = 0;
    let dropped = 0;
    const bridge = otel ? require('./pinoOtel').createOtelBridge(otel) : null;
    const levelNames = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
    function failure() { hookErrors++; }
    function observe(record) {
        const level = typeof record.level === 'number' ? levelNames[record.level] : record.level;
        if (Object.hasOwn(counts, level)) counts[level]++;
        // Suppress observers for logs made by an observer, including async descendants.
        if (scope.getStore()) return;
        scope.run(true, () => {
            if (bridge) {
                try { bridge.emit(record); } catch (_) { failure(); }
            }
            if (onLog) {
                // In-flight promises cannot be cancelled: drop the newest callback only.
                if (pending.size >= onLogMaxPending) { dropped++; return; }
                try {
                    // Mutation of the callback record cannot change output or OTel data.
                    const result = onLog(JSON.parse(JSON.stringify(record)));
                    if (result && typeof result.then === 'function') {
                        const task = Promise.resolve(result).catch(failure);
                        pending.add(task);
                        task.finally(() => pending.delete(task));
                    }
                } catch (_) { failure(); }
            }
        });
    }
    return {
        context: () => bridge ? bridge.context() : {},
        observe,
        streamWrite(line) { observe(JSON.parse(line)); return line; },
        stats: () => ({ levels: { ...counts }, hookErrors, onLog: { pending: pending.size, dropped, limit: onLogMaxPending } }),
        reset() { for (const key of Object.keys(counts)) counts[key] = 0; hookErrors = 0; dropped = 0; },
        async flush(timeout = 5000) {
            await withTimeout((async () => {
                while (pending.size) await Promise.all([...pending]);
                if (bridge) await bridge.flush();
            })(), timeout, 'Log observers flush');
        },
    };
}
module.exports = { createLogObserver };
