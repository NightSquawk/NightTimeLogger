'use strict';

/**
 * @file /tests/pinoHooks.test.js
 * @description Tests for the Pino sampling / rate limiting / deduplication adapter.
 *              Uses a real pino instance writing newline-delimited JSON into an in-memory sink.
 */

const { Writable } = require('stream');
const pino = require('pino');

const { createPinoFeatures, PINO_LEVEL_TO_NTL } = require('../lib/pinoHooks');

/**
 * Create an in-memory destination that parses newline-delimited JSON.
 * @returns {Writable} - Writable stream exposing a `lines` array of parsed objects
 */
function createSink() {
    const lines = [];
    const stream = new Writable({
        write(chunk, encoding, callback) {
            const text = chunk.toString('utf8');
            for (const line of text.split('\n')) {
                if (line.trim().length > 0) {
                    lines.push(JSON.parse(line));
                }
            }
            callback();
        },
    });
    stream.lines = lines;
    return stream;
}

/**
 * Build a pino logger wired to the feature hook.
 * @param {object} features - Result of createPinoFeatures
 * @param {object} [extraOpts] - Extra pino options
 * @returns {{logger: object, lines: Array}} - Logger and collected lines
 */
function makeLogger(features, extraOpts = {}) {
    const sink = createSink();
    const logger = pino(
        Object.assign({ level: 'trace', hooks: { logMethod: features.logMethod } }, extraOpts),
        sink
    );
    return { logger, lines: sink.lines };
}

describe('PINO_LEVEL_TO_NTL', () => {
    test('maps pino numeric levels to NTL level names', () => {
        expect(PINO_LEVEL_TO_NTL).toEqual({
            10: 'trace',
            20: 'debug',
            30: 'info',
            40: 'warn',
            50: 'error',
            60: 'fatal',
        });
    });

    test('is frozen', () => {
        expect(Object.isFrozen(PINO_LEVEL_TO_NTL)).toBe(true);
    });
});

describe('createPinoFeatures - enablement', () => {
    test('enabled is false when nothing is configured', () => {
        const features = createPinoFeatures();
        expect(features.enabled).toBe(false);
        expect(features.sampler).toBeNull();
        expect(features.deduplicator).toBeNull();
        expect(features.getStats()).toEqual({ sampling: null, deduplication: null });
        features.destroy();
    });

    test('enabled is false for empty/disabled config objects', () => {
        const features = createPinoFeatures({
            sampling: {},
            rateLimit: {},
            deduplication: { enabled: false, threshold: 3, window: 60000 },
        });
        expect(features.enabled).toBe(false);
        features.destroy();
    });

    test('enabled is true when sampling is configured', () => {
        const features = createPinoFeatures({ sampling: { debug: 0.5 } });
        expect(features.enabled).toBe(true);
        features.destroy();
    });

    test('enabled is true when rateLimit is configured', () => {
        const features = createPinoFeatures({ rateLimit: { info: { max: 1, window: 1000 } } });
        expect(features.enabled).toBe(true);
        features.destroy();
    });

    test('deduplication: true is accepted as shorthand', () => {
        const features = createPinoFeatures({ deduplication: true });
        expect(features.enabled).toBe(true);
        expect(features.deduplicator.enabled).toBe(true);
        features.destroy();
    });

    test('deduplication accepts windowMs as an alias for window', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, windowMs: 5000, threshold: 3 } });
        expect(features.deduplicator.window).toBe(5000);
        expect(features.deduplicator.threshold).toBe(3);
        features.destroy();
    });
});

describe('sampling', () => {
    let randomSpy;

    beforeEach(() => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
        randomSpy.mockRestore();
    });

    test('rate 0 drops every line for that level', () => {
        const features = createPinoFeatures({ sampling: { debug: 0 } });
        const { logger, lines } = makeLogger(features);

        for (let i = 0; i < 5; i++) {
            logger.debug('noisy');
        }
        logger.info('kept');

        expect(lines.filter((l) => l.level === 20)).toHaveLength(0);
        expect(lines.filter((l) => l.level === 30)).toHaveLength(1);
        expect(features.getStats().sampling.sampled.debug).toBe(5);
        features.destroy();
    });

    test('rate 1 passes everything through', () => {
        const features = createPinoFeatures({ sampling: { debug: 1 } });
        const { logger, lines } = makeLogger(features);

        for (let i = 0; i < 4; i++) {
            logger.debug('kept');
        }

        expect(lines).toHaveLength(4);
        expect(features.getStats().sampling.sampled.debug || 0).toBe(0);
        features.destroy();
    });

    test('fractional rate keeps lines under the threshold and drops above it', () => {
        const features = createPinoFeatures({ sampling: { info: 0.5 } });
        const { logger, lines } = makeLogger(features);

        randomSpy.mockReturnValue(0.4);
        logger.info('kept');
        randomSpy.mockReturnValue(0.6);
        logger.info('dropped');

        expect(lines).toHaveLength(1);
        expect(lines[0].msg).toBe('kept');
        features.destroy();
    });

    test('levels not listed in the sampling config are untouched', () => {
        const features = createPinoFeatures({ sampling: { trace: 0 } });
        const { logger, lines } = makeLogger(features);

        logger.trace('gone');
        logger.debug('here');
        logger.warn('here');

        expect(lines.map((l) => l.msg)).toEqual(['here', 'here']);
        features.destroy();
    });
});

describe('rate limiting', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('allows max per window, drops the rest, then recovers', () => {
        const features = createPinoFeatures({ rateLimit: { info: { max: 2, window: 1000 } } });
        const { logger, lines } = makeLogger(features);

        logger.info('a');
        logger.info('b');
        logger.info('c');
        logger.info('d');

        expect(lines.map((l) => l.msg)).toEqual(['a', 'b']);
        expect(features.getStats().sampling.rateLimited.info).toBe(2);

        jest.advanceTimersByTime(1500);

        logger.info('e');
        expect(lines.map((l) => l.msg)).toEqual(['a', 'b', 'e']);

        features.destroy();
    });

    test('rate limits are per level', () => {
        const features = createPinoFeatures({ rateLimit: { warn: { max: 1, window: 1000 } } });
        const { logger, lines } = makeLogger(features);

        logger.warn('w1');
        logger.warn('w2');
        logger.error('e1');
        logger.error('e2');

        expect(lines.map((l) => l.msg)).toEqual(['w1', 'e1', 'e2']);
        features.destroy();
    });

    test('windowMs alias is accepted for rate limits', () => {
        const features = createPinoFeatures({ rateLimit: { info: { max: 1, windowMs: 1000 } } });
        const { logger, lines } = makeLogger(features);

        logger.info('a');
        logger.info('b');
        expect(lines).toHaveLength(1);

        jest.advanceTimersByTime(1200);
        logger.info('c');
        expect(lines).toHaveLength(2);

        features.destroy();
    });

    test('rate limiting is applied before sampling', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
        const features = createPinoFeatures({
            sampling: { info: 0.5 },
            rateLimit: { info: { max: 1, window: 1000 } },
        });
        const { logger, lines } = makeLogger(features);

        logger.info('a'); // sampled out (0.9 > 0.5), but counted against the rate limit
        logger.info('b'); // rate limited

        const stats = features.getStats().sampling;
        expect(lines).toHaveLength(0);
        expect(stats.sampled.info).toBe(1);
        expect(stats.rateLimited.info).toBe(1);

        randomSpy.mockRestore();
        features.destroy();
    });
});

describe('deduplication', () => {
    test('emits up to the threshold, tags the threshold line, then suppresses', () => {
        const features = createPinoFeatures({
            deduplication: { enabled: true, threshold: 3, windowMs: 5000 },
        });
        const { logger, lines } = makeLogger(features);

        // These differ only in numbers/uuids, so messageNormalizer collapses them.
        logger.info('Ticket already exists for device 2642');
        logger.info('Ticket already exists for device 7788');
        logger.info('Ticket already exists for device 1010');
        logger.info('Ticket already exists for device 3030');
        logger.info('Ticket already exists for device 4040');

        expect(lines.map((l) => l.msg)).toEqual([
            'Ticket already exists for device 2642',
            'Ticket already exists for device 7788',
            'Ticket already exists for device 1010 (x3)',
        ]);

        const stats = features.getStats().deduplication;
        expect(stats.uniqueMessages).toBe(1);
        expect(stats.totalDeduplicated).toBeGreaterThan(0);
        features.destroy();
    });

    test('collapses messages that differ only by uuid', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, threshold: 2 } });
        const { logger, lines } = makeLogger(features);

        logger.warn('Threshold a481199f-ed1c-47c6-834d-9cf54cdc394e breached');
        logger.warn('Threshold b581299f-ed1c-47c6-834d-9cf54cdc394e breached');
        logger.warn('Threshold c681399f-ed1c-47c6-834d-9cf54cdc394e breached');

        expect(lines).toHaveLength(2);
        expect(lines[1].msg).toBe('Threshold b581299f-ed1c-47c6-834d-9cf54cdc394e breached (x2)');
        features.destroy();
    });

    test('distinct messages are tracked separately', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, threshold: 2 } });
        const { logger, lines } = makeLogger(features);

        logger.info('alpha');
        logger.info('beta');
        logger.info('alpha');
        logger.info('beta');

        expect(lines.map((l) => l.msg)).toEqual(['alpha', 'beta', 'alpha (x2)', 'beta (x2)']);
        expect(features.getStats().deduplication.uniqueMessages).toBe(2);
        features.destroy();
    });

    test('levels are part of the fingerprint', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, threshold: 2 } });
        const { logger, lines } = makeLogger(features);

        logger.info('same text');
        logger.warn('same text');

        expect(lines).toHaveLength(2);
        expect(lines.every((l) => !String(l.msg).includes('(x'))).toBe(true);
        features.destroy();
    });

    test('module on the merge object separates fingerprints', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, threshold: 2 } });
        const { logger, lines } = makeLogger(features);

        logger.info({ module: 'A' }, 'shared');
        logger.info({ module: 'B' }, 'shared');
        logger.info({ module: 'A' }, 'shared');

        expect(lines.map((l) => l.msg)).toEqual(['shared', 'shared', 'shared (x2)']);
        features.destroy();
    });

    test('defaultLocation is used when no module is present', () => {
        const features = createPinoFeatures({
            deduplication: { enabled: true, threshold: 2 },
            defaultLocation: 'kaleidoscope',
        });
        const { logger, lines } = makeLogger(features);

        logger.info('plain');
        logger.info('plain');

        expect(lines[1].msg).toBe('plain (x2)');
        features.destroy();
    });

    test('deduplication.levels restricts which levels are deduplicated', () => {
        const features = createPinoFeatures({
            deduplication: { enabled: true, threshold: 2, levels: ['debug'] },
        });
        const { logger, lines } = makeLogger(features);

        logger.info('noisy');
        logger.info('noisy');
        logger.info('noisy');
        logger.debug('noisy');
        logger.debug('noisy');
        logger.debug('noisy');

        const infoMsgs = lines.filter((l) => l.level === 30).map((l) => l.msg);
        const debugMsgs = lines.filter((l) => l.level === 20).map((l) => l.msg);
        expect(infoMsgs).toEqual(['noisy', 'noisy', 'noisy']);
        expect(debugMsgs).toEqual(['noisy', 'noisy (x2)']);
        features.destroy();
    });

    test('does not retain references to logged payloads', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, threshold: 5 } });
        const { logger } = makeLogger(features);

        logger.info({ module: 'svc', payload: { secret: 'SECRET_PAYLOAD' } }, 'with payload');

        const entries = Array.from(features.deduplicator.entries.values());
        expect(entries).toHaveLength(1);
        expect(JSON.stringify(entries)).not.toContain('SECRET_PAYLOAD');
        expect(entries[0].sample.meta).toEqual({ location: 'svc' });
        features.destroy();
    });
});

describe('argument shapes', () => {
    /**
     * Build a dedup-only feature set with threshold 2.
     * @returns {object} - Features
     */
    function dedupFeatures() {
        return createPinoFeatures({ deduplication: { enabled: true, threshold: 2 } });
    }

    test('(msg)', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.info('plain message');
        logger.info('plain message');

        expect(lines.map((l) => l.msg)).toEqual(['plain message', 'plain message (x2)']);
        features.destroy();
    });

    test('(msg, ...interpolationArgs)', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.info('hello %s', 'world');
        logger.info('hello %s', 'world');

        expect(lines.map((l) => l.msg)).toEqual(['hello world', 'hello world (x2)']);
        features.destroy();
    });

    test('interpolation arguments participate in the fingerprint', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.info('user %s connected', 'alice');
        logger.info('user %s connected', 'bob');

        expect(lines.map((l) => l.msg)).toEqual(['user alice connected', 'user bob connected']);
        features.destroy();
    });

    test('(mergeObject, msg, ...args)', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.info({ module: 'svc', reqId: 1 }, 'handled %s', 'GET');
        logger.info({ module: 'svc', reqId: 2 }, 'handled %s', 'GET');

        expect(lines.map((l) => l.msg)).toEqual(['handled GET', 'handled GET (x2)']);
        expect(lines[1].module).toBe('svc');
        expect(lines[1].reqId).toBe(2);
        features.destroy();
    });

    test('(error)', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.error(new Error('kaboom'));
        logger.error(new Error('kaboom'));

        expect(lines).toHaveLength(2);
        expect(lines[0].msg).toBe('kaboom');
        expect(lines[1].msg).toBe('kaboom (x2)');
        expect(lines[1].err && lines[1].err.type).toBe('Error');
        features.destroy();
    });

    test('(error, msg)', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.error(new Error('inner'), 'outer failure');
        logger.error(new Error('inner'), 'outer failure');

        expect(lines.map((l) => l.msg)).toEqual(['outer failure', 'outer failure (x2)']);
        features.destroy();
    });

    test('(mergeObject) with no msg passes through untouched', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.info({ module: 'svc', event: 'tick' });
        logger.info({ module: 'svc', event: 'tick' });
        logger.info({ module: 'svc', event: 'tick' });

        expect(lines).toHaveLength(3);
        expect(lines.every((l) => l.msg === undefined)).toBe(true);
        features.destroy();
    });

    test('no-argument calls pass through', () => {
        const features = dedupFeatures();
        const { logger, lines } = makeLogger(features);

        logger.info();
        logger.info();

        expect(lines).toHaveLength(2);
        features.destroy();
    });

    test('sampling still applies to object-only calls', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        const features = createPinoFeatures({ sampling: { info: 0 } });
        const { logger, lines } = makeLogger(features);

        logger.info({ module: 'svc', event: 'tick' });

        expect(lines).toHaveLength(0);
        randomSpy.mockRestore();
        features.destroy();
    });
});

describe('fatal handling', () => {
    test('fatal is never sampled away unless explicitly listed', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        const features = createPinoFeatures({ sampling: { info: 0, error: 0 } });
        const { logger, lines } = makeLogger(features);

        logger.info('dropped');
        logger.error('dropped');
        logger.fatal('always emitted');

        expect(lines.map((l) => l.msg)).toEqual(['always emitted']);
        randomSpy.mockRestore();
        features.destroy();
    });

    test('fatal is sampled when explicitly listed', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        const features = createPinoFeatures({ sampling: { fatal: 0 } });
        const { logger, lines } = makeLogger(features);

        logger.fatal('dropped');

        expect(lines).toHaveLength(0);
        randomSpy.mockRestore();
        features.destroy();
    });

    test('fatal is never rate limited unless explicitly listed', () => {
        const features = createPinoFeatures({ rateLimit: { error: { max: 1, window: 60000 } } });
        const { logger, lines } = makeLogger(features);

        logger.fatal('f1');
        logger.fatal('f2');
        logger.fatal('f3');

        expect(lines).toHaveLength(3);
        features.destroy();
    });

    test('fatal is rate limited when explicitly listed', () => {
        const features = createPinoFeatures({ rateLimit: { fatal: { max: 1, window: 60000 } } });
        const { logger, lines } = makeLogger(features);

        logger.fatal('f1');
        logger.fatal('f2');

        expect(lines).toHaveLength(1);
        features.destroy();
    });

    test('fatal is never deduplicated by default', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, threshold: 2 } });
        const { logger, lines } = makeLogger(features);

        logger.fatal('the same fatal');
        logger.fatal('the same fatal');
        logger.fatal('the same fatal');

        expect(lines.map((l) => l.msg)).toEqual(['the same fatal', 'the same fatal', 'the same fatal']);
        features.destroy();
    });

    test('fatal is deduplicated when opted in explicitly', () => {
        const features = createPinoFeatures({ deduplication: { enabled: true, threshold: 2, fatal: true } });
        const { logger, lines } = makeLogger(features);

        logger.fatal('the same fatal');
        logger.fatal('the same fatal');
        logger.fatal('the same fatal');

        expect(lines.map((l) => l.msg)).toEqual(['the same fatal', 'the same fatal (x2)']);
        features.destroy();
    });

    test('fatal is deduplicated when listed in deduplication.levels', () => {
        const features = createPinoFeatures({
            deduplication: { enabled: true, threshold: 2, levels: ['fatal'] },
        });
        const { logger, lines } = makeLogger(features);

        logger.fatal('boom');
        logger.fatal('boom');

        expect(lines.map((l) => l.msg)).toEqual(['boom', 'boom (x2)']);
        features.destroy();
    });
});

describe('custom levels', () => {
    test('custom levels are resolved through the levels map', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
        const sink = createSink();
        const customLevels = { audit: 35 };

        // Resolve the level map the same way an integrator would (pino exposes levels.values).
        const probe = pino({ level: 'trace', customLevels }, createSink());
        const features = createPinoFeatures({ sampling: { audit: 0 }, levels: probe.levels.values });

        const logger = pino(
            { level: 'trace', customLevels, hooks: { logMethod: features.logMethod } },
            sink
        );

        logger.audit('dropped');
        logger.info('kept');

        expect(sink.lines.map((l) => l.msg)).toEqual(['kept']);
        randomSpy.mockRestore();
        features.destroy();
    });

    test('unresolvable custom levels pass through unfiltered', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
        const sink = createSink();
        const features = createPinoFeatures({ sampling: { audit: 0, info: 0 } });

        const logger = pino(
            {
                level: 'trace',
                customLevels: { audit: 35 },
                hooks: { logMethod: features.logMethod },
            },
            sink
        );

        logger.audit('passed through');
        logger.info('dropped');

        expect(sink.lines.map((l) => l.msg)).toEqual(['passed through']);
        randomSpy.mockRestore();
        features.destroy();
    });
});

describe('stats', () => {
    test('getStats returns the sampling and deduplication shapes', () => {
        const features = createPinoFeatures({
            sampling: { debug: 1 },
            rateLimit: { info: { max: 10, window: 60000 } },
            deduplication: { enabled: true, threshold: 2 },
        });
        const { logger } = makeLogger(features);

        logger.debug('d1');
        logger.info('i1');
        logger.info('i1');
        logger.info('i1');

        const stats = features.getStats();
        expect(Object.keys(stats).sort()).toEqual(['deduplication', 'sampling']);
        expect(stats.sampling).toEqual({
            total: expect.any(Object),
            sampled: expect.any(Object),
            rateLimited: expect.any(Object),
        });
        expect(stats.sampling.total.info).toBe(3);
        expect(stats.deduplication).toEqual({
            totalDeduplicated: expect.any(Number),
            uniqueMessages: 2,
            activeEntries: 2,
        });
        features.destroy();
    });

    test('resetStats clears counters on both features', () => {
        const features = createPinoFeatures({
            sampling: { info: 1 },
            deduplication: { enabled: true, threshold: 2 },
        });
        const { logger } = makeLogger(features);

        logger.info('x');
        logger.info('x');

        features.resetStats();

        const stats = features.getStats();
        expect(stats.sampling.total).toEqual({});
        expect(stats.deduplication.totalDeduplicated).toBe(0);
        expect(stats.deduplication.uniqueMessages).toBe(0);
        features.destroy();
    });

    test('getStats tolerates injected objects without stats support', () => {
        const features = createPinoFeatures({ sampler: { shouldProcess: () => true } });
        expect(features.getStats()).toEqual({ sampling: null, deduplication: null });
        expect(() => features.resetStats()).not.toThrow();
        features.destroy();
    });
});

describe('destroy', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('clears the sampler and deduplicator timers', () => {
        const before = jest.getTimerCount();
        const features = createPinoFeatures({
            rateLimit: { info: { max: 1, window: 1000 } },
            deduplication: { enabled: true, threshold: 2, windowMs: 1000 },
        });

        expect(jest.getTimerCount()).toBe(before + 2);

        features.destroy();

        expect(jest.getTimerCount()).toBe(before);
        expect(features.sampler.cleanupInterval).toBeNull();
        expect(features.deduplicator.cleanupInterval).toBeNull();
    });

    test('is safe to call with no features configured', () => {
        const features = createPinoFeatures();
        expect(() => features.destroy()).not.toThrow();
    });
});

describe('failure isolation', () => {
    test('a throwing sampler still logs the line', () => {
        const features = createPinoFeatures({
            sampler: {
                shouldProcess() {
                    throw new Error('sampler exploded');
                },
            },
        });
        const { logger, lines } = makeLogger(features);

        expect(() => logger.info('must survive')).not.toThrow();
        expect(lines.map((l) => l.msg)).toEqual(['must survive']);
        features.destroy();
    });

    test('a throwing deduplicator still logs the line', () => {
        const features = createPinoFeatures({
            deduplicator: {
                check() {
                    throw new Error('dedup exploded');
                },
            },
        });
        const { logger, lines } = makeLogger(features);

        logger.warn({ module: 'svc' }, 'still here');

        expect(lines).toHaveLength(1);
        expect(lines[0].msg).toBe('still here');
        expect(lines[0].module).toBe('svc');
        features.destroy();
    });

    test('a deduplicator returning garbage does not lose the line', () => {
        const features = createPinoFeatures({
            deduplicator: {
                check() {
                    return { shouldLog: true, count: 4, message: null };
                },
            },
        });
        const { logger, lines } = makeLogger(features);

        logger.info('resilient');

        expect(lines.map((l) => l.msg)).toEqual(['resilient']);
        features.destroy();
    });

    test('errors thrown by the underlying log method are not swallowed or double-logged', () => {
        const features = createPinoFeatures({ sampling: { info: 1 } });
        const calls = [];
        const method = function method(...args) {
            calls.push(args);
            throw new Error('serializer blew up');
        };

        expect(() => features.logMethod.call({}, ['boom'], method, 30)).toThrow('serializer blew up');
        expect(calls).toHaveLength(1);
        features.destroy();
    });
});
