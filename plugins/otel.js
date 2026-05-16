/**
 * @file /plugins/otel.js
 * @description Sends logs to an OpenTelemetry collector via the OTLP Logs SDK.
 *
 * OpenTelemetry packages are optional peer dependencies. Install them when using this plugin:
 *   npm install @opentelemetry/api @opentelemetry/api-logs @opentelemetry/sdk-logs \
 *               @opentelemetry/exporter-logs-otlp-http @opentelemetry/resources \
 *               @opentelemetry/semantic-conventions
 *
 * For gRPC or protobuf transport, install the corresponding exporter package and
 * pass it via the `exporter` option.
 */

const Transport = require('winston-transport');
const levels = require('../lib/levels');

const ANSI_REGEX = /\[[0-9;]*m/g;

function stripAnsi(str) {
    if (typeof str !== 'string') return str;
    return str.replace(ANSI_REGEX, '');
}

/**
 * Map ntlogger levels to OpenTelemetry SeverityNumber values.
 * See: https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
const SEVERITY_NUMBER = {
    internal: 1,  // TRACE
    trace:    1,  // TRACE
    debug:    5,  // DEBUG
    info:     9,  // INFO
    warn:     13, // WARN
    error:    17, // ERROR
    fatal:    21, // FATAL
};

const SEVERITY_TEXT = {
    internal: 'TRACE',
    trace:    'TRACE',
    debug:    'DEBUG',
    info:     'INFO',
    warn:     'WARN',
    error:    'ERROR',
    fatal:    'FATAL',
};

/**
 * Lazily require an OTel package, returning null if it's not installed.
 * Lets the plugin loader skip OTel gracefully when deps are missing.
 */
function tryRequire(name) {
    try {
        return require(name);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND') return null;
        throw err;
    }
}

class OpenTelemetryTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'OpenTelemetry Transport for NTLogger';

        // Level threshold (default: log everything down to 'trace')
        this.level = opts.level || 'trace';
        if (!(this.level in levels)) {
            throw new Error(`Invalid log level: ${this.level}`);
        }
        this.levelPriority = levels[this.level];

        this.includeTraceContext = opts.includeTraceContext !== false;
        this.stripAnsi = opts.stripAnsi !== false;

        // Caller-supplied LoggerProvider takes precedence and lets the plugin
        // run without the OTel SDK packages installed (useful for tests).
        if (opts.loggerProvider) {
            this.loggerProvider = opts.loggerProvider;
            this._ownsProvider = false;
        } else {
            const sdkLogs = tryRequire('@opentelemetry/sdk-logs');
            if (!sdkLogs) {
                throw new Error(
                    'OpenTelemetry plugin requires @opentelemetry/sdk-logs (and an exporter) ' +
                    'when no `loggerProvider` is supplied. ' +
                    'Install with: npm install @opentelemetry/sdk-logs @opentelemetry/api-logs @opentelemetry/exporter-logs-otlp-http'
                );
            }
            this.loggerProvider = this._buildLoggerProvider(opts, sdkLogs);
            this._ownsProvider = true;
        }

        const instrumentationName = opts.instrumentationName || 'ntlogger';
        const instrumentationVersion = opts.instrumentationVersion || undefined;
        this.otelLogger = this.loggerProvider.getLogger(instrumentationName, instrumentationVersion);

        // Optional @opentelemetry/api for trace context correlation
        if (this.includeTraceContext) {
            const api = tryRequire('@opentelemetry/api');
            this._traceApi = api && api.trace ? api.trace : null;
        }
    }

    /**
     * Build a LoggerProvider from configuration when one isn't supplied.
     */
    _buildLoggerProvider(opts, sdkLogs) {
        const { LoggerProvider, BatchLogRecordProcessor, SimpleLogRecordProcessor } = sdkLogs;

        let exporter = opts.exporter;
        if (!exporter) {
            const otlpHttp = tryRequire('@opentelemetry/exporter-logs-otlp-http');
            if (!otlpHttp) {
                throw new Error(
                    'OpenTelemetry plugin requires either an `exporter` instance or ' +
                    '@opentelemetry/exporter-logs-otlp-http installed. ' +
                    'Install with: npm install @opentelemetry/exporter-logs-otlp-http'
                );
            }
            exporter = new otlpHttp.OTLPLogExporter({
                url: opts.url,
                headers: opts.headers,
                concurrencyLimit: opts.concurrencyLimit,
                timeoutMillis: opts.timeoutMillis,
            });
        }

        const Processor = opts.useSimpleProcessor ? SimpleLogRecordProcessor : BatchLogRecordProcessor;
        const processor = new Processor(exporter, opts.processorOptions || {});

        let resource;
        const resources = tryRequire('@opentelemetry/resources');
        if (resources && (opts.resource || opts.resourceAttributes || opts.serviceName)) {
            if (opts.resource) {
                resource = opts.resource;
            } else {
                const attrs = { ...(opts.resourceAttributes || {}) };
                if (opts.serviceName) {
                    const semconv = tryRequire('@opentelemetry/semantic-conventions');
                    const key = (semconv && semconv.ATTR_SERVICE_NAME) || 'service.name';
                    attrs[key] = opts.serviceName;
                    if (opts.serviceVersion) {
                        const vkey = (semconv && semconv.ATTR_SERVICE_VERSION) || 'service.version';
                        attrs[vkey] = opts.serviceVersion;
                    }
                }
                resource = resources.resourceFromAttributes
                    ? resources.resourceFromAttributes(attrs)
                    : new resources.Resource(attrs);
            }
        }

        return new LoggerProvider({
            resource,
            processors: [processor],
        });
    }

    /**
     * Flatten metadata into OTel-compatible primitive/array attributes.
     * Objects are JSON-stringified since OTel attributes can't be nested.
     */
    _toAttributes(meta) {
        const attrs = {};
        for (const [key, value] of Object.entries(meta)) {
            if (value === null || value === undefined) continue;
            if (key === 'timestamp' || key === 'timeCreated') continue;

            const t = typeof value;
            if (t === 'string') {
                attrs[key] = this.stripAnsi ? stripAnsi(value) : value;
            } else if (t === 'number' || t === 'boolean') {
                attrs[key] = value;
            } else if (Array.isArray(value)) {
                attrs[key] = value.map(v =>
                    typeof v === 'object' && v !== null ? JSON.stringify(v) : v
                );
            } else if (t === 'object') {
                try {
                    attrs[key] = JSON.stringify(value);
                } catch {
                    attrs[key] = String(value);
                }
            } else {
                attrs[key] = String(value);
            }
        }
        return attrs;
    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        const { level, message, ...meta } = info;

        if (levels[level] === undefined || levels[level] > this.levelPriority) {
            callback();
            return;
        }

        const severityNumber = SEVERITY_NUMBER[level] ?? SEVERITY_NUMBER.info;
        const severityText = SEVERITY_TEXT[level] || String(level).toUpperCase();
        const body = this.stripAnsi && typeof message === 'string' ? stripAnsi(message) : message;

        const record = {
            severityNumber,
            severityText,
            body,
            attributes: this._toAttributes(meta),
        };

        if (this._traceApi) {
            const span = this._traceApi.getActiveSpan();
            const ctx = span && span.spanContext && span.spanContext();
            if (ctx && ctx.traceId && ctx.spanId) {
                record.traceId = ctx.traceId;
                record.spanId = ctx.spanId;
                if (typeof ctx.traceFlags === 'number') {
                    record.traceFlags = ctx.traceFlags;
                }
            }
        }

        try {
            this.otelLogger.emit(record);
        } catch (err) {
            console.error(`OpenTelemetry transport emit failed: ${err.message}`);
        }

        callback();
    }

    /**
     * Force-flush pending log records.
     */
    flush() {
        if (this.loggerProvider && typeof this.loggerProvider.forceFlush === 'function') {
            return this.loggerProvider.forceFlush();
        }
        return Promise.resolve();
    }

    /**
     * Shut down the LoggerProvider (only if this transport created it).
     */
    async close() {
        if (this._ownsProvider && this.loggerProvider && typeof this.loggerProvider.shutdown === 'function') {
            try {
                await this.loggerProvider.shutdown();
            } catch (err) {
                console.error(`OpenTelemetry transport shutdown failed: ${err.message}`);
            }
        }
    }
}

module.exports = {
    transport: OpenTelemetryTransport,
    SEVERITY_NUMBER,
    SEVERITY_TEXT,
};
