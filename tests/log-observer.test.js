'use strict';
const { createTestLogger } = require('../pino');

test('tee receives emitted redacted child records, counts exclude filters and reset across children', async () => {
    const received = [];
    const { logger, records } = createTestLogger({ level: 'info', sampling: { info: 0 }, onLog: r => { received.push(r); r.msg = 'changed'; } });
    logger.debug('filtered');
    logger.info('sampled');
    const child = logger.child({ jobId: 'j1', password: 'binding-secret' });
    child.warn({ token: 'payload-secret' }, 'warning');
    child.error(new Error('password=error-secret'));
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ jobId: 'j1', password: '[REDACTED]', token: '[REDACTED]' });
    expect(records[0].msg).toBe('warning');
    expect(JSON.stringify(received)).not.toContain('error-secret');
    expect(logger.getStats().levels).toMatchObject({ info: 0, debug: 0, warn: 1, error: 1 });
    const snapshot = child.getStats();
    snapshot.levels.warn = 999;
    expect(logger.getStats().levels.warn).toBe(1);
    child.resetStats();
    expect(logger.getStats().levels.warn).toBe(0);
    await logger.close();
});

test('tee sees native path redaction, interpolated messages and dedup filtering', async () => {
    const seen = [];
    const { logger, records } = createTestLogger({ redact: ['private.pin'], deduplication: { threshold: 2 }, onLog: r => seen.push(r) });
    for (let i = 0; i < 8; i++) logger.info({ private: { pin: '1234' } }, 'hello %s', 'world');
    expect(seen).toEqual(records);
    expect(seen.length).toBeLessThan(8);
    expect(seen[0].private.pin).toBe('[Redacted]');
    expect(seen[0].msg).toBe('hello world');
    expect(logger.getStats().levels.info).toBe(records.length);
    await logger.close();
});

test('sync/async callback errors are contained and async recursive logging does not recurse', async () => {
    let logger;
    const captured = createTestLogger({ onLog: async record => {
        if (record.msg === 'fail') throw new Error('callback failed');
        await Promise.resolve();
        logger.warn('nested');
    } });
    logger = captured.logger;
    logger.info('outer');
    logger.info('fail');
    await new Promise(resolve => setImmediate(resolve));
    expect(captured.records.map(r => r.msg)).toEqual(['outer', 'fail', 'nested']);
    expect(logger.getStats().hookErrors).toBe(1);
    expect(logger.getStats().levels.warn).toBe(1);
    await logger.close();
    const sync = createTestLogger({ onLog() { throw new Error('sync'); } });
    expect(() => sync.logger.info('still emitted')).not.toThrow();
    expect(sync.records).toHaveLength(1);
    expect(sync.logger.getStats().hookErrors).toBe(1);
    await sync.logger.close();
});

test('close drains callback promises and returns bounded failure for a stuck callback', async () => {
    let finish;
    const { logger } = createTestLogger({ onLog: () => new Promise(resolve => { finish = resolve; }) });
    logger.info('queued');
    const closing = logger.close(1000);
    let settled = false;
    closing.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    expect(await closing).toEqual({ drained: true });
    const stuck = createTestLogger({ onLog: () => new Promise(() => {}) });
    stuck.logger.warn('queued forever');
    expect(await stuck.logger.close(20)).toMatchObject({ drained: false, error: expect.any(Error) });
});

test('closing is idempotent, covers disabled/extracted methods and descendants, and isolates children', async () => {
    const { logger, records } = createTestLogger({ level: 'error' });
    const child = logger.child({ jobId: 1 });
    const grandchild = child.child({ step: 1 });
    const extracted = child.debug;
    const firstClose = child.close();
    expect(child.close()).toBe(firstClose);
    await firstClose;
    expect(() => extracted('closed')).toThrow('closed');
    expect(() => grandchild.error('closed')).toThrow('closed');
    expect(() => child.child({})).toThrow('closed');
    child.level = 'trace';
    expect(() => child.info('closed')).toThrow('closed');
    logger.error('parent remains open');
    expect(records).toHaveLength(1);
    const sibling = logger.child({});
    const rootClose = logger.close();
    expect(logger.close()).toBe(rootClose);
    await rootClose;
    expect(() => sibling.trace('closed')).toThrow('closed');
    expect(() => logger.silent('closed')).toThrow('closed');
    const silent = createTestLogger({ silent: true });
    silent.logger.info('suppressed');
    expect(silent.logger.getStats().levels.info).toBe(0);
    await silent.logger.close();
    expect(() => silent.logger.info('closed')).toThrow('closed');
});

test('Winston tee and per-level stats share redaction and flush async callbacks', async () => {
    const createLogger = require('../');
    const received = [];
    const logger = createLogger('observer', { file: false, console: false, skipCache: true,
        plugins: [{ name: 'Jest', enabled: true, config: {} }],
        onLog: async record => { await Promise.resolve(); received.push(record); },
    });
    logger.debug('filtered');
    logger.child({ jobId: 'j1' }).warn('password=message-secret', { token: 'payload-secret' });
    await logger.flush();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ jobId: 'j1', token: '[REDACTED]', level: 'warn' });
    expect(JSON.stringify(received)).not.toContain('message-secret');
    expect(logger.getStats().levels).toMatchObject({ debug: 0, warn: 1 });
    logger.resetStats();
    expect(logger.getStats().levels.warn).toBe(0);
    await logger.close();
});

test('bounded callbacks drop newest, preserve primary/OTel output, and recover capacity', async () => {
    const release = [];
    const exported = [];
    const { logger, records } = createTestLogger({
        onLogMaxPending: 2,
        onLog: () => new Promise(resolve => release.push(resolve)),
        otel: { loggerProvider: { getLogger: () => ({ emit: record => exported.push(record) }) } },
    });
    for (let i = 0; i < 5; i++) logger.info('event');
    expect(records).toHaveLength(5);
    expect(exported).toHaveLength(5);
    expect(release).toHaveLength(2);
    expect(logger.getStats().onLog).toEqual({ pending: 2, dropped: 3, limit: 2 });
    logger.resetStats();
    expect(logger.getStats().onLog).toEqual({ pending: 2, dropped: 0, limit: 2 });
    release[0]();
    await new Promise(resolve => setImmediate(resolve));
    logger.info('capacity recovered');
    expect(release).toHaveLength(3);
    release.forEach(resolve => resolve());
    await logger.close();
    expect(logger.getStats().onLog.pending).toBe(0);
});

test('zero callback capacity disables callbacks and invalid capacities are rejected', async () => {
    const onLog = jest.fn();
    const { logger, records } = createTestLogger({ onLogMaxPending: 0, onLog });
    logger.warn('primary');
    expect(onLog).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(logger.getStats().onLog.dropped).toBe(1);
    await logger.close();
    for (const onLogMaxPending of [-1, 0.5, Infinity, NaN]) {
        expect(() => createTestLogger({ onLogMaxPending })).toThrow(/onLogMaxPending/);
    }
});
