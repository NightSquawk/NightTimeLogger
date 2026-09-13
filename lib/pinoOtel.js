'use strict';

// No SDK/provider is created or registered here. Export through the application's
// existing logs provider in the calling thread, where active context is available.
function createOtelBridge(options) {
    const opts = options === true ? {} : options;
    const api = require('@opentelemetry/api');
    const provider = opts.loggerProvider || require('@opentelemetry/api-logs').logs.getLoggerProvider();
    const logger = provider.getLogger(opts.name || 'ntlogger');
    const severity = { 10: 1, 20: 5, 30: 9, 40: 13, 50: 17, 60: 21,
        trace: 1, debug: 5, info: 9, warn: 13, error: 17, fatal: 21, internal: 1 };
    const names = { 1: 'TRACE', 5: 'DEBUG', 9: 'INFO', 13: 'WARN', 17: 'ERROR', 21: 'FATAL' };
    return {
        context() {
            const span = api.trace.getActiveSpan();
            const ctx = span && span.spanContext();
            return ctx && api.isSpanContextValid(ctx)
                ? { traceId: ctx.traceId, spanId: ctx.spanId, traceFlags: ctx.traceFlags }
                : {};
        },
        emit(record) {
            const attributes = {};
            for (const [key, value] of Object.entries(record)) {
                if (['level', 'msg', 'message', 'time', 'timestamp'].includes(key) || value == null) continue;
                attributes[key] = typeof value === 'object' ? JSON.stringify(value) : value;
            }
            if (record.err) {
                if (record.err.type) attributes['exception.type'] = record.err.type;
                if (record.err.message) attributes['exception.message'] = record.err.message;
                if (record.err.stack) attributes['exception.stacktrace'] = record.err.stack;
            }
            const severityNumber = severity[record.level] || 9;
            logger.emit({
                context: api.context.active(),
                timestamp: new Date(record.time ?? record.timestamp ?? Date.now()),
                severityNumber, severityText: names[severityNumber],
                body: record.msg ?? record.message ?? '', attributes,
            });
        },
        flush: () => typeof provider.forceFlush === 'function' ? provider.forceFlush() : Promise.resolve(),
    };
}
module.exports = { createOtelBridge };
