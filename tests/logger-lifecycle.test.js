/**
 * @file /tests/logger-lifecycle.test.js
 * @description Covers logger.js code paths that the original test suite skips:
 *              cache hit/skipCache/cache-invalidation, flush, close, object-form
 *              message extraction, debug:true diagnostics, and the wrapper's
 *              error-recovery fallback.
 */

const logger = require('../lib/logger');
const { LogDeduplicator } = require('../lib/logDeduplicator');

// Helper: yield long enough for the setImmediate-wrapped log to land.
const flushImmediates = async (n = 2) => {
    for (let i = 0; i < n; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
};

const baseConfig = (overrides = {}) => ({
    level: 'internal',
    console: false,
    file: false,
    skipCache: true,
    plugins: [{ name: 'Jest', enabled: true, config: {} }],
    ...overrides,
});

describe('logger caching', () => {
    test('second call with same location returns the cached instance', () => {
        const loc = `Cache-Hit-${Date.now()}`;
        const a = logger(loc, { console: false, file: false });
        const b = logger(loc);
        expect(b).toBe(a);
    });

    test('skipCache: true returns a fresh instance', () => {
        const loc = `Cache-Skip-${Date.now()}`;
        const a = logger(loc, { console: false, file: false });
        const b = logger(loc, { console: false, file: false, skipCache: true });
        expect(b).not.toBe(a);
    });

    test('requesting sampling on a feature-less cached logger recreates it', () => {
        const loc = `Cache-Invalidate-${Date.now()}`;
        const first = logger(loc, { console: false, file: false });
        expect(first.getStats().sampling).toBeNull();

        const second = logger(loc, {
            console: false,
            file: false,
            sampling: { debug: 0.5 },
        });
        expect(second.getStats().sampling).not.toBeNull();
        expect(second).not.toBe(first);
    });

    test('requesting deduplication on a feature-less cached logger recreates it', () => {
        const loc = `Cache-Dedup-${Date.now()}`;
        const first = logger(loc, { console: false, file: false });
        expect(first.getStats().deduplication).toBeNull();

        const second = logger(loc, {
            console: false,
            file: false,
            deduplication: { enabled: true, threshold: 3, window: 60000 },
        });
        expect(second.getStats().deduplication).not.toBeNull();
        expect(second).not.toBe(first);
    });

    test('subsequent advanced-feature call returns the cached feature-enabled logger', () => {
        const loc = `Cache-Reuse-${Date.now()}`;
        const cfg = {
            console: false,
            file: false,
            sampling: { debug: 0.5 },
        };
        const first = logger(loc, cfg);
        const second = logger(loc, cfg);
        expect(second).toBe(first);
    });
});

describe('logger.flush and logger.close', () => {
    test('flush() resolves without throwing', async () => {
        const log = logger(`Flush-${Date.now()}`, baseConfig());
        await expect(log.flush()).resolves.toBeUndefined();
    });

    test('close() resolves and tears down sampler/deduplicator', async () => {
        const log = logger(`Close-${Date.now()}`, baseConfig({
            sampling: { debug: 0.5 },
            deduplication: { enabled: true, threshold: 3, window: 60000 },
        }));
        await expect(log.close()).resolves.toBeUndefined();
    });

    test('close() works when no feature modules are present', async () => {
        const log = logger(`Close-Bare-${Date.now()}`, baseConfig());
        await expect(log.close()).resolves.toBeUndefined();
    });
});

describe('object-form message argument', () => {
    test('extracts message and meta from a single object argument', async () => {
        const log = logger(`ObjForm-${Date.now()}`, baseConfig({ level: 'info' }));
        const jestT = log.transports.find(t => t.name === 'JestTransport');
        jestT.clearMessages();

        log.info({ message: 'hello-from-obj', userId: 42 });
        await flushImmediates();

        const msgs = jestT.getMessages('info');
        expect(msgs.length).toBe(1);
        expect(msgs[0].message).toBe('hello-from-obj');
        expect(msgs[0].meta.userId).toBe(42);
    });

    test('falls back to JSON.stringify when object has no message field', async () => {
        const log = logger(`ObjForm-NoMsg-${Date.now()}`, baseConfig({ level: 'info' }));
        const jestT = log.transports.find(t => t.name === 'JestTransport');
        jestT.clearMessages();

        log.info({ event: 'tick', count: 1 });
        await flushImmediates();

        const msgs = jestT.getMessages('info');
        expect(msgs.length).toBe(1);
        expect(msgs[0].message).toContain('"event":"tick"');
    });
});

describe('debug: true diagnostics', () => {
    test('logs three internal diagnostics on creation', async () => {
        const log = logger(`DebugTrue-${Date.now()}`, baseConfig({
            debug: true,
        }));
        const jestT = log.transports.find(t => t.name === 'JestTransport');

        // The internal messages are emitted at creation time, but go through
        // the setImmediate-wrapped pipeline.
        await flushImmediates(4);

        const internals = jestT.getMessages('internal');
        const creationMsgs = internals.filter(m => m.message.includes('Logger instance created'));
        expect(creationMsgs.length).toBeGreaterThanOrEqual(3);
    });
});

describe('wrapper error-recovery fallback', () => {
    test('a thrown deduplicator falls back to the original method', async () => {
        const checkSpy = jest.spyOn(LogDeduplicator.prototype, 'check')
            .mockImplementation(() => { throw new Error('boom'); });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const log = logger(`Wrapper-Recover-${Date.now()}`, baseConfig({
                level: 'info',
                deduplication: { enabled: true, threshold: 3, window: 60000 },
            }));
            const jestT = log.transports.find(t => t.name === 'JestTransport');
            jestT.clearMessages();

            expect(() => log.info('survives-error')).not.toThrow();
            await flushImmediates();

            const messages = jestT.getMessages('info');
            expect(messages.some(m => m.message === 'survives-error')).toBe(true);
        } finally {
            checkSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });
});
