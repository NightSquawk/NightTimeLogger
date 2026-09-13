'use strict';
const { spawnSync } = require('node:child_process');
const api = require('@opentelemetry/api');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { LoggerProvider, SimpleLogRecordProcessor, InMemoryLogRecordExporter } = require('@opentelemetry/sdk-logs');
const { createTestLogger, createPinoOptions } = require('../pino');
const spanContext = { traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef', traceFlags: 1 };
let manager;
beforeEach(() => { manager = new AsyncLocalStorageContextManager().enable(); api.context.setGlobalContextManager(manager); });
afterEach(() => { api.context.disable(); manager.disable(); });

function inSpan(fn) { return api.context.with(api.trace.setSpanContext(api.ROOT_CONTEXT, spanContext), fn); }

test('active span correlates serialized Pino and real SDK records without taking provider ownership', async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    const shutdown = jest.spyOn(provider, 'shutdown');
    const { logger, records } = createTestLogger({ otel: { loggerProvider: provider }, onLog: r => { r.traceId = 'mutated'; } });
    try {
        await inSpan(async () => {
            await Promise.resolve();
            logger.child({ jobId: 'j1' }).error(new Error('password=span-secret'));
        });
        logger.info('outside span');
        expect(await logger.close()).toEqual({ drained: true });
        const exported = exporter.getFinishedLogRecords();
        expect(exported).toHaveLength(2);
        expect(exported[0].spanContext).toMatchObject(spanContext);
        expect(records[0]).toMatchObject(spanContext);
        expect(exported[0].severityNumber).toBe(17);
        expect(exported[0].attributes.jobId).toBe('j1');
        expect(exported[0].attributes['exception.type']).toBe('Error');
        expect(JSON.stringify(exported)).not.toContain('span-secret');
        expect(exported[1].spanContext).toBeUndefined();
        expect(records[1].traceId).toBeUndefined();
        expect(shutdown).not.toHaveBeenCalled();
    } finally { await logger.close(); await provider.shutdown(); }
});

test('options factory exports through supplied SDK and honors native path redaction', async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    try {
        const logger = require('pino')(createPinoOptions({ silent: false, redact: ['secret.pin'], otel: { loggerProvider: provider } }), { write() {} });
        inSpan(() => logger.info({ secret: { pin: '1234' } }, 'framework'));
        await provider.forceFlush();
        expect(exporter.getFinishedLogRecords()[0].attributes.secret).not.toContain('1234');
        expect(exporter.getFinishedLogRecords()[0].spanContext.traceId).toBe(spanContext.traceId);
    } finally { await provider.shutdown(); }
});

test('OTLP HTTP collector receives a redacted record with the active trace ID', () => {
    // Run outside Jest's VM so the real HTTP exporter's dynamic imports work.
    const result = spawnSync(process.execPath, [require.resolve('./fixtures/otel-collector.cjs')], {
        encoding: 'utf8', timeout: 15000,
    });
    expect(result.error).toBeUndefined();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout).toContain('OTLP correlation and redaction verified');
});

test('observer counts SDK emit errors and surfaces provider flush failures', async () => {
    const { logger } = createTestLogger({ otel: { loggerProvider: {
        getLogger: () => ({ emit() { throw new Error('emit'); } }),
        forceFlush: async () => { throw new Error('flush'); },
    } } });
    expect(() => logger.info('still logged')).not.toThrow();
    expect(logger.getStats().hookErrors).toBe(1);
    expect(await logger.close()).toMatchObject({ drained: false, error: expect.any(Error) });
});

test('otel true uses an already registered global provider', async () => {
    const { logs } = require('@opentelemetry/api-logs');
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    logs.setGlobalLoggerProvider(provider);
    const { logger } = createTestLogger({ otel: true });
    try {
        inSpan(() => logger.info('global'));
        await logger.close();
        expect(exporter.getFinishedLogRecords()[0].spanContext).toMatchObject(spanContext);
    } finally { logs.disable(); await logger.close(); await provider.shutdown(); }
});

test('Winston bridge retains active span across deferred logging and exports redacted metadata', async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    const logger = require('../')('otel-bridge', { skipCache: true, console: false, file: false,
        plugins: [{ name: 'Jest', enabled: true, config: {} }], otel: { loggerProvider: provider },
    });
    try {
        inSpan(() => logger.warn('bridge', { password: 'winston-secret' }));
        await logger.flush();
        const record = exporter.getFinishedLogRecords()[0];
        expect(record.spanContext).toMatchObject(spanContext);
        expect(record.attributes.password).toBe('[REDACTED]');
        expect(record.severityNumber).toBe(13);
    } finally { await logger.close(); await provider.shutdown(); }
});
