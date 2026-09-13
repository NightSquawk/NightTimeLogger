'use strict';

/**
 * Tests for `createLogger()` in pino.js.
 *
 * Everything that needs to inspect the emitted JSON uses the undocumented
 * `destination` passthrough: it replaces the NTL worker transport with an
 * in-process sink, so the whole pipeline (hooks -> mixin -> formatters ->
 * serializers) runs on this thread and can be asserted synchronously.
 *
 * The real worker transport is exercised end-to-end in tests/pino-consumer.test.js.
 */

const EventEmitter = require('events');
const { AsyncLocalStorage } = require('async_hooks');

const ntlPino = require('../pino');
const { createLogger, isSilent } = ntlPino;

/**
 * Collecting Pino destination.
 * @returns {{write: Function, lines: string[], objects: Function, last: Function, reset: Function}} - Sink.
 */
function makeSink() {
    const lines = [];
    return {
        lines,
        write(chunk) {
            for (const line of String(chunk).split('\n')) {
                if (line.trim()) lines.push(line);
            }
        },
        objects() {
            return lines.map(line => JSON.parse(line));
        },
        last() {
            return JSON.parse(lines[lines.length - 1]);
        },
        reset() {
            lines.length = 0;
        },
    };
}

/**
 * Build a logger writing into a fresh sink. `silent: false` is forced because
 * Jest sets NODE_ENV=test, which makes createLogger silent by default.
 * @param {object} [opts] - createLogger options.
 * @returns {{log: object, sink: object}} - Logger and its sink.
 */
function build(opts = {}) {
    const sink = makeSink();
    const log = createLogger(Object.assign({ silent: false, level: 'trace', destination: sink }, opts));
    return { log, sink };
}

const BEARER = 'Bearer abcdefghijklmnop1234567890';

describe('createLogger — module exports', () => {
    test('still exposes the transport internals unchanged', () => {
        for (const name of ['formatLine', 'formatTimestamp', 'padLevel', 'formatContext', 'createRequestTracker']) {
            expect(typeof ntlPino[name]).toBe('function');
        }
        expect(Array.isArray(ntlPino.CONTEXT_KEYS)).toBe(true);
        expect(ntlPino.CONTEXT_KEYS).toContain('tenantId');
        expect(ntlPino.CONTEXT_KEYS).toContain('correlationId');
        expect(typeof ntlPino).toBe('function'); // the transport factory itself
    });

    test('re-exports the process handler helpers', () => {
        const handlers = require('../lib/processHandlers');
        expect(ntlPino.installProcessHandlers).toBe(handlers.installProcessHandlers);
        expect(ntlPino.drainLogger).toBe(handlers.drainLogger);
        expect(typeof ntlPino.createLogger).toBe('function');
        expect(typeof ntlPino.isSilent).toBe('function');
    });
});

describe('createLogger — baseline behaviour', () => {
    test('keeps the module mixin and honours an explicit level', () => {
        const { log, sink } = build({ module: 'API', level: 'warn' });
        log.info('dropped');
        log.warn('kept');
        expect(sink.lines).toHaveLength(1);
        expect(sink.last()).toMatchObject({ module: 'API', msg: 'kept', level: 40 });
    });

    test('falls back to LOG_LEVEL', () => {
        const previous = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'error';
        try {
            const sink = makeSink();
            const log = createLogger({ silent: false, destination: sink });
            expect(log.level).toBe('error');
        } finally {
            if (previous === undefined) delete process.env.LOG_LEVEL;
            else process.env.LOG_LEVEL = previous;
        }
    });

    test('returns a real Pino logger (object-first signature)', () => {
        const { log, sink } = build();
        log.info({ tenantId: 't-1' }, 'object first');
        expect(sink.last()).toMatchObject({ tenantId: 't-1', msg: 'object first' });
        expect(typeof log.child).toBe('function');
        expect(typeof log.flush).toBe('function');
    });
});

describe('createLogger — service field (F)', () => {
    test('adds a constant top-level service and keeps pid/hostname', () => {
        const { log, sink } = build({ service: 'kaleidoscope' });
        log.info('svc');
        const line = sink.last();
        expect(line.service).toBe('kaleidoscope');
        expect(line.pid).toBe(process.pid);
        expect(typeof line.hostname).toBe('string');
    });

    test('a log-call field beats the service binding', () => {
        const { log, sink } = build({ service: 'base-service' });
        log.info({ service: 'override' }, 'svc');
        expect(sink.last().service).toBe('override');
    });
});

describe('createLogger — contextProvider (A)', () => {
    test('an AsyncLocalStorage store lands at the top level', () => {
        const als = new AsyncLocalStorage();
        const { log, sink } = build({ module: 'Ctx', contextProvider: () => als.getStore() });

        als.run({ tenantId: 'tenant-9', correlationId: 'corr-9' }, () => {
            log.info('inside request');
        });
        log.info('outside request');

        const [inside, outside] = sink.objects();
        expect(inside).toMatchObject({ module: 'Ctx', tenantId: 'tenant-9', correlationId: 'corr-9' });
        expect(outside.tenantId).toBeUndefined();
        expect(outside.module).toBe('Ctx');
    });

    test('explicit fields on the call win over provider fields', () => {
        const { log, sink } = build({ contextProvider: () => ({ tenantId: 'from-provider', userId: 'u-1' }) });
        log.info({ tenantId: 'from-call' }, 'precedence');
        expect(sink.last()).toMatchObject({ tenantId: 'from-call', userId: 'u-1' });
    });

    test('contextKeys picks only the requested keys', () => {
        const { log, sink } = build({
            contextProvider: () => ({ tenantId: 't', correlationId: 'c', hugeInternalState: { a: 1 }, secretish: 'x' }),
            contextKeys: ['tenantId', 'correlationId'],
        });
        log.info('picked');
        const line = sink.last();
        expect(line).toMatchObject({ tenantId: 't', correlationId: 'c' });
        expect(line.hugeInternalState).toBeUndefined();
        expect(line.secretish).toBeUndefined();
    });

    test('static context merges first and the provider wins over it', () => {
        const { log, sink } = build({
            module: 'M',
            context: { service: 'static-svc', region: 'us-east-1' },
            contextProvider: () => ({ region: 'eu-west-1' }),
        });
        log.info('merged');
        expect(sink.last()).toMatchObject({ module: 'M', service: 'static-svc', region: 'eu-west-1' });
    });

    test('a throwing provider never breaks logging and warns once', () => {
        const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
        try {
            const { log, sink } = build({
                module: 'Boom',
                contextProvider: () => { throw new Error('provider exploded'); },
            });
            log.info('first');
            log.info('second');
            expect(sink.lines).toHaveLength(2);
            expect(sink.last()).toMatchObject({ module: 'Boom', msg: 'second' });
            // warnOnce is process-wide; it must not warn per call.
            const contextWarnings = warn.mock.calls.filter(c => c[1] === 'NTLoggerContextWarning');
            expect(contextWarnings.length).toBeLessThanOrEqual(1);
        } finally {
            warn.mockRestore();
        }
    });

    test('non-object provider results are ignored', () => {
        for (const value of ['nope', 42, null, undefined, ['a'], true]) {
            const { log, sink } = build({ module: 'Ig', contextProvider: () => value });
            log.info('ignored');
            const line = sink.last();
            expect(line.module).toBe('Ig');
            expect(line.msg).toBe('ignored');
            expect(line[0]).toBeUndefined();
        }
    });
});

describe('createLogger — redaction (B)', () => {
    test('is on by default for message, interpolation arg, nested meta and Error message', () => {
        const { log, sink } = build();

        log.info(`auth header is ${BEARER}`);
        log.info('auth header is %s', BEARER);
        log.warn({ request: { headers: { authorization: BEARER } }, note: BEARER }, 'nested meta');
        log.error(new Error(`failed: ${BEARER}`));

        const [message, interpolated, meta, errLine] = sink.objects();

        expect(message.msg).toBe('auth header is Bearer [REDACTED]');
        expect(interpolated.msg).toBe('auth header is Bearer [REDACTED]');
        expect(meta.request.headers.authorization).toBe('[REDACTED]');
        expect(meta.note).toBe('Bearer [REDACTED]');
        expect(errLine.err.message).toBe('failed: Bearer [REDACTED]');
        expect(errLine.msg).toBe('failed: Bearer [REDACTED]');
    });

    test('the err serializer path keeps Pino\'s shape, including stack', () => {
        const { log, sink } = build();
        const err = new TypeError(`bad token ${BEARER}`);
        err.code = 'E_TOKEN';

        log.error({ err }, 'wrapped');
        const line = sink.last();

        expect(line.err.type).toBe('TypeError');
        expect(line.err.code).toBe('E_TOKEN');
        expect(typeof line.err.stack).toBe('string');
        expect(line.err.stack).toContain('TypeError: bad token Bearer [REDACTED]');
        expect(line.err.stack).not.toContain('abcdefghijklmnop');
        expect(line.msg).toBe('wrapped');
    });

    test('logging a bare Error keeps msg in sync with the redacted message', () => {
        const { log, sink } = build();
        log.error(new Error(`token=${BEARER}`));
        const line = sink.last();
        expect(line.msg).not.toContain('abcdefghijklmnop');
        expect(line.err.message).toBe(line.msg);
    });

    test('redact: false disables redaction entirely', () => {
        const { log, sink } = build({ redact: false });
        log.info({ password: 'hunter2' }, `raw ${BEARER}`);
        const line = sink.last();
        expect(line.msg).toBe(`raw ${BEARER}`);
        expect(line.password).toBe('hunter2');
    });

    test('a plain string array becomes extraKeys', () => {
        const { log, sink } = build({ redact: ['deviceFingerprint'] });
        log.info({ deviceFingerprint: 'fp-123', keepMe: 'visible' }, 'keys');
        expect(sink.last()).toMatchObject({ deviceFingerprint: '[REDACTED]', keepMe: 'visible' });
    });

    test('Pino-style paths are forwarded to Pino\'s native redact option', () => {
        const { log, sink } = build({ redact: ['payload.cardNumber', 'plainKey'] });
        log.info({ payload: { cardNumber: '4111111111111111', ok: 'yes' }, plainKey: 'v' }, 'paths');
        const line = sink.last();
        // Pino's own redaction uses its own token, ours uses [REDACTED].
        expect(line.payload.cardNumber).toBe('[Redacted]');
        expect(line.payload.ok).toBe('yes');
        expect(line.plainKey).toBe('[REDACTED]');
    });

    test('an object is forwarded to createRedactor', () => {
        const { log, sink } = build({ redact: { replacement: '***', extraKeys: ['licensePlate'] } });
        log.info({ licensePlate: 'ABC-123', password: 'p' }, 'custom');
        expect(sink.last()).toMatchObject({ licensePlate: '***', password: '***' });
    });

    test('child bindings are redacted', () => {
        const { log, sink } = build({ module: 'Parent' });
        const child = log.child({ apiKey: 'sk_live_abcdefghijklmnop', component: 'worker' });
        child.info('child line');
        expect(sink.last()).toMatchObject({ apiKey: '[REDACTED]', component: 'worker', module: 'Parent' });
    });

    test('the base bindings formatter leaves pid/hostname/service alone', () => {
        const { log, sink } = build({ service: 'svc' });
        log.info('base');
        expect(sink.last()).toMatchObject({ service: 'svc', pid: process.pid });
    });
});

describe('createLogger — sampling / rate limiting / deduplication (C)', () => {
    test('rate limiting drops lines and is reflected in getStats/resetStats', () => {
        const { log, sink } = build({ module: 'RL', rateLimit: { info: { max: 2, window: 60000 } } });
        for (let i = 0; i < 5; i++) log.info(`line ${i}`);

        expect(sink.lines).toHaveLength(2);
        expect(log.getStats().sampling.rateLimited.info).toBe(3);

        log.resetStats();
        expect(log.getStats().sampling.rateLimited.info || 0).toBe(0);
        log.close();
    });

    test('sampling at rate 0 drops everything except fatal', () => {
        const { log, sink } = build({ sampling: { info: 0 } });
        log.info('sampled out');
        log.fatal('never sampled');
        expect(sink.lines).toHaveLength(1);
        expect(sink.last().msg).toBe('never sampled');
        log.close();
    });

    test('deduplication collapses repeats and suffixes the count', () => {
        const { log, sink } = build({ deduplication: { enabled: true, threshold: 2, window: 60000 } });
        for (let i = 0; i < 5; i++) log.info('repeated message');

        const messages = sink.objects().map(o => o.msg);
        expect(messages.length).toBeLessThan(5);
        expect(messages[0]).toBe('repeated message');
        expect(messages[messages.length - 1]).toMatch(/\(x\d+\)$/);
        log.close();
    });

    test('zero-config loggers report empty stats', () => {
        const { log } = build();
        expect(log.getStats()).toMatchObject({ sampling: null, deduplication: null });
        expect(() => log.resetStats()).not.toThrow();
    });

    test('getStats/resetStats/close are inherited by children and close() resolves', async () => {
        const { log } = build({ rateLimit: { info: { max: 1, window: 60000 } } });
        const child = log.child({ component: 'c' });

        expect(typeof child.getStats).toBe('function');
        expect(typeof child.resetStats).toBe('function');
        expect(typeof child.close).toBe('function');
        expect(child.getStats()).toEqual(log.getStats());

        // Not written onto Pino's shared prototype.
        expect(Object.prototype.hasOwnProperty.call(log, 'close')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(child, 'close')).toBe(false);
        const otherLogger = require('pino')({ level: 'silent' });
        expect(otherLogger.close).toBeUndefined();
        expect(otherLogger.getStats).toBeUndefined();

        await expect(log.close(1000)).resolves.toMatchObject({ drained: true });
    });

    test('a grandchild keeps every binding level', () => {
        const { log, sink } = build({ module: 'Root' });
        log.child({ a: 1 }).child({ b: 2 }).info('deep');
        expect(sink.last()).toMatchObject({ module: 'Root', a: 1, b: 2, msg: 'deep' });
    });
});

describe('createLogger — silent mode (D)', () => {
    const ENV_KEYS = ['NTLOGGER_SILENT', 'NODE_ENV'];
    let saved;

    beforeEach(() => {
        saved = {};
        for (const key of ENV_KEYS) saved[key] = process.env[key];
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    /**
     * Set the env for one resolution check.
     * @param {string|undefined} envValue - NTLOGGER_SILENT value.
     * @param {string|undefined} nodeEnv - NODE_ENV value.
     * @returns {void}
     */
    function setEnv(envValue, nodeEnv) {
        if (envValue === undefined) delete process.env.NTLOGGER_SILENT;
        else process.env.NTLOGGER_SILENT = envValue;
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
    }

    test.each([
        // opts.silent, NTLOGGER_SILENT, NODE_ENV, expected
        [true, '0', 'production', true],
        [false, '1', 'test', false],
        [undefined, '1', 'production', true],
        [undefined, 'true', 'production', true],
        [undefined, 'YES', 'production', true],
        [undefined, '0', 'test', false],
        [undefined, 'false', 'test', false],
        [undefined, 'no', 'test', false],
        [undefined, '', 'test', true],
        [undefined, 'maybe', 'test', true],
        [undefined, 'maybe', 'production', false],
        [undefined, undefined, 'test', true],
        [undefined, undefined, 'production', false],
        [undefined, undefined, undefined, false],
    ])('isSilent({ silent: %p }) with NTLOGGER_SILENT=%p NODE_ENV=%p -> %p', (silent, env, nodeEnv, expected) => {
        setEnv(env, nodeEnv);
        expect(isSilent(silent === undefined ? {} : { silent })).toBe(expected);
    });

    test('a silent logger emits nothing, has level "silent", and still exposes the API', async () => {
        const sink = makeSink();
        const log = createLogger({ module: 'Quiet', silent: true, destination: sink });

        log.info('nothing');
        log.fatal('not even this');

        expect(log.level).toBe('silent');
        expect(sink.lines).toHaveLength(0);
        expect(log.getStats()).toMatchObject({ sampling: null, deduplication: null });
        expect(() => log.resetStats()).not.toThrow();
        await expect(log.close(500)).resolves.toMatchObject({ drained: true });
    });

    test('NODE_ENV=test makes createLogger silent by default', () => {
        setEnv(undefined, 'test');
        const sink = makeSink();
        const log = createLogger({ module: 'Default', destination: sink });
        log.info('suppressed');
        expect(log.level).toBe('silent');
        expect(sink.lines).toHaveLength(0);
    });
});

describe('createLogger — process handlers (E)', () => {
    test('are not installed unless asked for', () => {
        const { log } = build();
        expect(log.uninstallProcessHandlers).toBeUndefined();
    });

    test('opt-in installs handlers on an injected process and exposes uninstall', async () => {
        const proc = new EventEmitter();
        proc.setMaxListeners(20);
        const exit = jest.fn();

        const sink = makeSink();
        const log = createLogger({
            silent: false,
            level: 'trace',
            destination: sink,
            module: 'Handlers',
            processHandlers: { proc, exit, timeout: 200 },
        });

        expect(typeof log.uninstallProcessHandlers).toBe('function');
        expect(proc.listenerCount('uncaughtException')).toBe(1);
        expect(proc.listenerCount('SIGTERM')).toBe(1);

        proc.emit('uncaughtException', new Error('kaboom'), 'uncaughtException');
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(exit).toHaveBeenCalledWith(1);
        const fatal = sink.objects().find(o => o.level === 60);
        expect(fatal).toBeDefined();
        expect(fatal.err.message).toBe('kaboom');

        log.uninstallProcessHandlers();
        expect(proc.listenerCount('uncaughtException')).toBe(0);
        expect(proc.listenerCount('SIGTERM')).toBe(0);
    });

    test('processHandlers: true installs the default signal set', () => {
        const proc = new EventEmitter();
        const { log } = build({ processHandlers: { proc, exit: () => {} } });
        try {
            expect(typeof log.uninstallProcessHandlers).toBe('function');
            expect(proc.listenerCount('unhandledRejection')).toBe(1);
            expect(proc.listenerCount('SIGINT')).toBe(1);
        } finally {
            log.uninstallProcessHandlers();
        }
        expect(proc.listenerCount('unhandledRejection')).toBe(0);
    });

    test('processHandlers: true (boolean) attaches to the real process and uninstalls cleanly', () => {
        const before = process.listenerCount('uncaughtException');
        const { log } = build({ processHandlers: true });
        try {
            expect(process.listenerCount('uncaughtException')).toBe(before + 1);
        } finally {
            log.uninstallProcessHandlers();
        }
        expect(process.listenerCount('uncaughtException')).toBe(before);
    });
});
