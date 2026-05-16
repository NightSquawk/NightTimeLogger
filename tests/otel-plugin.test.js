/**
 * @file /tests/otel-plugin.test.js
 * @description Tests for the OpenTelemetry plugin transport.
 *
 * These tests inject a mock LoggerProvider so the OTel SDK packages don't need
 * to be installed to verify the transport's behavior.
 */

const { transport: OpenTelemetryTransport, SEVERITY_NUMBER, SEVERITY_TEXT } = require('../plugins/otel');

/**
 * Build a mock LoggerProvider/Logger that captures emitted records.
 */
function makeMockProvider() {
    const emitted = [];
    const flushCalls = [];
    const shutdownCalls = [];

    const otelLogger = {
        emit: (record) => emitted.push(record),
    };

    const provider = {
        getLogger: jest.fn().mockReturnValue(otelLogger),
        forceFlush: jest.fn(() => {
            flushCalls.push(Date.now());
            return Promise.resolve();
        }),
        shutdown: jest.fn(() => {
            shutdownCalls.push(Date.now());
            return Promise.resolve();
        }),
    };

    return { provider, emitted, flushCalls, shutdownCalls };
}

describe('OpenTelemetry plugin transport', () => {
    test('SEVERITY_NUMBER maps ntlogger levels to OTel severity numbers', () => {
        expect(SEVERITY_NUMBER.trace).toBe(1);
        expect(SEVERITY_NUMBER.internal).toBe(1);
        expect(SEVERITY_NUMBER.debug).toBe(5);
        expect(SEVERITY_NUMBER.info).toBe(9);
        expect(SEVERITY_NUMBER.warn).toBe(13);
        expect(SEVERITY_NUMBER.error).toBe(17);
        expect(SEVERITY_NUMBER.fatal).toBe(21);
    });

    test('SEVERITY_TEXT maps ntlogger levels to uppercase severity text', () => {
        expect(SEVERITY_TEXT.info).toBe('INFO');
        expect(SEVERITY_TEXT.error).toBe('ERROR');
        expect(SEVERITY_TEXT.fatal).toBe('FATAL');
    });

    test('emits a log record with body, severityNumber, and severityText', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });

        t.log({ level: 'info', message: 'hello world', userId: 42 }, () => {
            expect(emitted).toHaveLength(1);
            expect(emitted[0]).toMatchObject({
                severityNumber: 9,
                severityText: 'INFO',
                body: 'hello world',
                attributes: { userId: 42 },
            });
            done();
        });
    });

    test('respects level threshold and drops below-threshold records', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider, level: 'warn' });

        t.log({ level: 'debug', message: 'noisy' }, () => {
            t.log({ level: 'info', message: 'also noisy' }, () => {
                t.log({ level: 'warn', message: 'kept' }, () => {
                    t.log({ level: 'error', message: 'kept too' }, () => {
                        expect(emitted).toHaveLength(2);
                        expect(emitted.map(r => r.body)).toEqual(['kept', 'kept too']);
                        done();
                    });
                });
            });
        });
    });

    test('strips ANSI escape codes from string body and attributes by default', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });

        const colored = '[31mred message[0m';
        t.log({ level: 'info', message: colored, label: '[32mgreen[0m', count: 5 }, () => {
            expect(emitted[0].body).toBe('red message');
            expect(emitted[0].attributes.label).toBe('green');
            expect(emitted[0].attributes.count).toBe(5);
            done();
        });
    });

    test('preserves ANSI codes when stripAnsi is disabled', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider, stripAnsi: false });

        const colored = '[31mred message[0m';
        t.log({ level: 'info', message: colored }, () => {
            expect(emitted[0].body).toBe(colored);
            done();
        });
    });

    test('drops timestamp/timeCreated and serializes nested objects as JSON', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });

        t.log({
            level: 'info',
            message: 'test',
            timestamp: '2026-01-01T00:00:00Z',
            timeCreated: 123,
            nested: { a: 1, b: 'x' },
            list: [1, 'two', { three: 3 }],
            flag: true,
        }, () => {
            const attrs = emitted[0].attributes;
            expect(attrs.timestamp).toBeUndefined();
            expect(attrs.timeCreated).toBeUndefined();
            expect(attrs.nested).toBe('{"a":1,"b":"x"}');
            expect(attrs.list).toEqual([1, 'two', '{"three":3}']);
            expect(attrs.flag).toBe(true);
            done();
        });
    });

    test('skips null and undefined metadata values', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });

        t.log({ level: 'info', message: 'test', empty: null, missing: undefined, kept: 'yes' }, () => {
            const attrs = emitted[0].attributes;
            expect(attrs.empty).toBeUndefined();
            expect(attrs.missing).toBeUndefined();
            expect(attrs.kept).toBe('yes');
            done();
        });
    });

    test('passes instrumentationName and version to getLogger', () => {
        const { provider } = makeMockProvider();
        new OpenTelemetryTransport({
            loggerProvider: provider,
            instrumentationName: 'my-app-logger',
            instrumentationVersion: '2.3.4',
        });
        expect(provider.getLogger).toHaveBeenCalledWith('my-app-logger', '2.3.4');
    });

    test('defaults instrumentation name to "ntlogger"', () => {
        const { provider } = makeMockProvider();
        new OpenTelemetryTransport({ loggerProvider: provider });
        expect(provider.getLogger).toHaveBeenCalledWith('ntlogger', undefined);
    });

    test('flush() proxies to loggerProvider.forceFlush', async () => {
        const { provider } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });
        await t.flush();
        expect(provider.forceFlush).toHaveBeenCalledTimes(1);
    });

    test('close() does NOT shut down an externally-supplied loggerProvider', async () => {
        const { provider } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });
        await t.close();
        expect(provider.shutdown).not.toHaveBeenCalled();
    });

    test('throws on invalid log level', () => {
        const { provider } = makeMockProvider();
        expect(() => new OpenTelemetryTransport({ loggerProvider: provider, level: 'verbose' }))
            .toThrow(/Invalid log level/);
    });

    test('drops records with unknown level', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });

        t.log({ level: 'verbose', message: 'should drop' }, () => {
            expect(emitted).toHaveLength(0);
            done();
        });
    });
});

describe('OpenTelemetry plugin transport — trace correlation', () => {
    test('attaches traceId/spanId from active span when @opentelemetry/api is available', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });

        // Mock the trace API by injecting it directly on the instance.
        t._traceApi = {
            getActiveSpan: () => ({
                spanContext: () => ({
                    traceId: 'abc123',
                    spanId: 'def456',
                    traceFlags: 1,
                }),
            }),
        };

        t.log({ level: 'info', message: 'with trace' }, () => {
            expect(emitted[0].traceId).toBe('abc123');
            expect(emitted[0].spanId).toBe('def456');
            expect(emitted[0].traceFlags).toBe(1);
            done();
        });
    });

    test('omits trace fields when no active span', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider });

        t._traceApi = { getActiveSpan: () => undefined };

        t.log({ level: 'info', message: 'no trace' }, () => {
            expect(emitted[0].traceId).toBeUndefined();
            expect(emitted[0].spanId).toBeUndefined();
            done();
        });
    });

    test('does not attach trace context when includeTraceContext is false', (done) => {
        const { provider, emitted } = makeMockProvider();
        const t = new OpenTelemetryTransport({ loggerProvider: provider, includeTraceContext: false });

        expect(t._traceApi).toBeUndefined();

        t.log({ level: 'info', message: 'no correlation' }, () => {
            expect(emitted[0].traceId).toBeUndefined();
            done();
        });
    });
});

describe('OpenTelemetry plugin — registered with plugin loader', () => {
    test('OpenTelemetry is exported from plugins/index', () => {
        const { initPlugins } = require('../plugins/index');
        // Initializing with disabled OTel plugin should not throw and should return empty array.
        const transports = initPlugins([
            { name: 'OpenTelemetry', enabled: false, config: {} },
        ]);
        expect(transports).toEqual([]);
    });

    test('initPlugins creates an OpenTelemetry transport when given a mock loggerProvider', () => {
        const { initPlugins } = require('../plugins/index');
        const { provider } = makeMockProvider();

        const transports = initPlugins([
            { name: 'OpenTelemetry', enabled: true, config: { loggerProvider: provider } },
        ]);

        expect(transports).toHaveLength(1);
        expect(transports[0].name).toBe('OpenTelemetry Transport for NTLogger');
    });
});
