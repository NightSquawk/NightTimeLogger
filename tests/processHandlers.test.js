'use strict';

const EventEmitter = require('events');
const { installProcessHandlers, drainLogger } = require('../lib/processHandlers');

// Every test uses an injected EventEmitter and an exit spy: the real process
// handlers are never touched.
function makeProc() {
    const proc = new EventEmitter();
    proc.setMaxListeners(50);
    return proc;
}

function makeLogger(levels = ['fatal', 'error', 'warn', 'info', 'debug']) {
    const logger = {};
    for (const level of levels) logger[level] = jest.fn();
    return logger;
}

const tick = async (turns = 6) => {
    for (let i = 0; i < turns; i += 1) await new Promise(resolve => setImmediate(resolve));
};

describe('processHandlers - installProcessHandlers', () => {
    let consoleError;

    beforeEach(() => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
        jest.useRealTimers();
    });

    test('uncaughtException logs fatal with err and exits 1 after onShutdown runs', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const order = [];
        const onShutdown = jest.fn(async reason => { order.push(`hook:${reason}`); });

        const uninstall = installProcessHandlers(logger, { proc, exit, onShutdown, timeout: 500 });
        const err = new Error('boom');
        proc.emit('uncaughtException', err, 'uncaughtException');

        expect(logger.fatal).toHaveBeenCalledWith('Uncaught exception', { err, origin: 'uncaughtException' });
        await tick();

        expect(onShutdown).toHaveBeenCalledTimes(1);
        expect(onShutdown).toHaveBeenCalledWith('uncaughtException');
        expect(order).toEqual(['hook:uncaughtException']);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
        uninstall();
    });

    test('honours uncaughtExitCode and logPrefix', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();

        const uninstall = installProcessHandlers(logger, { proc, exit, uncaughtExitCode: 7, logPrefix: '[api]', timeout: 500 });
        proc.emit('uncaughtException', new Error('boom'), 'uncaughtException');
        await tick();

        expect(logger.fatal.mock.calls[0][0]).toBe('[api] Uncaught exception');
        expect(exit).toHaveBeenCalledWith(7);
        uninstall();
    });

    test('exits after the timeout even when onShutdown never resolves', async () => {
        jest.useFakeTimers();
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const onShutdown = jest.fn(() => new Promise(() => {}));

        const uninstall = installProcessHandlers(logger, { proc, exit, onShutdown, timeout: 4000 });
        proc.emit('uncaughtException', new Error('wedged'), 'uncaughtException');

        expect(exit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(4000);

        expect(onShutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
        uninstall();
    });

    test('unhandledRejection logs at error and does not exit by default', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const onShutdown = jest.fn();

        const uninstall = installProcessHandlers(logger, { proc, exit, onShutdown, timeout: 500 });
        const err = new Error('nope');
        proc.emit('unhandledRejection', err, Promise.reject(err).catch(() => {}));
        await tick();

        expect(logger.error).toHaveBeenCalledWith('Unhandled promise rejection', { err });
        expect(onShutdown).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
        uninstall();
    });

    test('unhandledRejection exits when exitOnUnhandledRejection is true', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const onShutdown = jest.fn(async () => {});

        const uninstall = installProcessHandlers(logger, {
            proc, exit, onShutdown, timeout: 500, exitOnUnhandledRejection: true, unhandledRejectionLevel: 'fatal',
        });
        proc.emit('unhandledRejection', new Error('nope'));
        await tick();

        expect(logger.fatal).toHaveBeenCalledTimes(1);
        expect(onShutdown).toHaveBeenCalledWith('unhandledRejection');
        expect(exit).toHaveBeenCalledWith(1);
        uninstall();
    });

    test('normalizes a non-Error rejection reason', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();

        const uninstall = installProcessHandlers(logger, { proc, exit, timeout: 500 });
        proc.emit('unhandledRejection', 'just a string');
        proc.emit('unhandledRejection', { code: 42 });
        await tick();

        const [firstMessage, firstMeta] = logger.error.mock.calls[0];
        expect(firstMessage).toBe('Unhandled promise rejection');
        expect(firstMeta.err).toBeInstanceOf(Error);
        expect(firstMeta.err.message).toBe('just a string');
        expect(firstMeta.err.name).toBe('NonErrorRejection');
        expect(firstMeta.err.reason).toBe('just a string');
        expect(typeof firstMeta.err.stack).toBe('string');

        const secondMeta = logger.error.mock.calls[1][1];
        expect(secondMeta.err).toBeInstanceOf(Error);
        expect(secondMeta.err.message).toContain('42');
        expect(secondMeta.err.reason).toEqual({ code: 42 });
        uninstall();
    });

    test('SIGTERM logs info, runs onShutdown and exits 0', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const onShutdown = jest.fn(async () => {});

        const uninstall = installProcessHandlers(logger, { proc, exit, onShutdown, timeout: 500 });
        proc.emit('SIGTERM');

        expect(logger.info).toHaveBeenCalledWith('Received SIGTERM, shutting down', { signal: 'SIGTERM' });
        await tick();

        expect(onShutdown).toHaveBeenCalledWith('SIGTERM');
        expect(exit).toHaveBeenCalledWith(0);
        uninstall();
    });

    test('a second SIGTERM during shutdown warns and force-exits with 128+n', async () => {
        jest.useFakeTimers();
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const onShutdown = jest.fn(() => new Promise(() => {}));

        const uninstall = installProcessHandlers(logger, { proc, exit, onShutdown, timeout: 30000 });
        proc.emit('SIGTERM');
        await Promise.resolve();
        proc.emit('SIGTERM');

        expect(logger.warn).toHaveBeenCalledWith('Received SIGTERM during shutdown, forcing exit', { signal: 'SIGTERM' });
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(143);
        expect(onShutdown).toHaveBeenCalledTimes(1);

        // SIGINT uses the same convention.
        jest.clearAllTimers();
        uninstall();
    });

    test('a second SIGINT during shutdown force-exits with 130', async () => {
        jest.useFakeTimers();
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();

        const uninstall = installProcessHandlers(logger, {
            proc, exit, timeout: 30000, onShutdown: () => new Promise(() => {}),
        });
        proc.emit('SIGINT');
        await Promise.resolve();
        proc.emit('SIGINT');

        expect(exit).toHaveBeenCalledWith(130);
        jest.clearAllTimers();
        uninstall();
    });

    test('re-entrancy guard: a crash during shutdown does not start a second shutdown', async () => {
        jest.useFakeTimers();
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const onShutdown = jest.fn(() => new Promise(() => {}));

        const uninstall = installProcessHandlers(logger, { proc, exit, onShutdown, timeout: 30000 });
        proc.emit('SIGTERM');
        await Promise.resolve();
        proc.emit('uncaughtException', new Error('late'), 'uncaughtException');
        proc.emit('unhandledRejection', new Error('later'));
        await Promise.resolve();

        expect(onShutdown).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();
        expect(logger.fatal).toHaveBeenCalledWith(
            'Uncaught exception during shutdown, already exiting',
            expect.objectContaining({ origin: 'uncaughtException' }),
        );
        expect(logger.error.mock.calls[0][0]).toBe('Unhandled promise rejection during shutdown, already exiting');

        jest.clearAllTimers();
        uninstall();
    });

    test('exitOnSignal false drains but does not exit', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();
        const onShutdown = jest.fn(async () => {});

        const uninstall = installProcessHandlers(logger, { proc, exit, onShutdown, exitOnSignal: false, timeout: 500 });
        proc.emit('SIGTERM');
        await tick();

        expect(onShutdown).toHaveBeenCalledWith('SIGTERM');
        expect(exit).not.toHaveBeenCalled();
        uninstall();
    });

    test('signals: [] installs no signal listeners', () => {
        const proc = makeProc();
        const logger = makeLogger();

        const uninstall = installProcessHandlers(logger, { proc, exit: jest.fn(), signals: [] });
        expect(proc.listenerCount('SIGTERM')).toBe(0);
        expect(proc.listenerCount('SIGINT')).toBe(0);
        expect(proc.listenerCount('uncaughtException')).toBe(1);
        expect(proc.listenerCount('unhandledRejection')).toBe(1);
        uninstall();
    });

    test('installing twice for the same logger returns the same uninstall and does not double-register', () => {
        const proc = makeProc();
        const logger = makeLogger();
        const before = {
            uncaughtException: proc.listenerCount('uncaughtException'),
            unhandledRejection: proc.listenerCount('unhandledRejection'),
            SIGTERM: proc.listenerCount('SIGTERM'),
            SIGINT: proc.listenerCount('SIGINT'),
        };

        const first = installProcessHandlers(logger, { proc, exit: jest.fn() });
        const second = installProcessHandlers(logger, { proc, exit: jest.fn(), timeout: 10 });
        expect(second).toBe(first);
        for (const event of Object.keys(before)) {
            expect(proc.listenerCount(event)).toBe(before[event] + 1);
        }

        first();
        for (const event of Object.keys(before)) {
            expect(proc.listenerCount(event)).toBe(before[event]);
        }

        // Second uninstall is a no-op...
        expect(() => first()).not.toThrow();
        for (const event of Object.keys(before)) {
            expect(proc.listenerCount(event)).toBe(before[event]);
        }

        // ...and the logger can be re-installed afterwards.
        const third = installProcessHandlers(logger, { proc, exit: jest.fn() });
        expect(third).not.toBe(first);
        expect(proc.listenerCount('SIGTERM')).toBe(before.SIGTERM + 1);
        third();
        expect(proc.listenerCount('SIGTERM')).toBe(before.SIGTERM);
    });

    test('a different logger installs a separate set of handlers', () => {
        const proc = makeProc();
        const a = makeLogger();
        const b = makeLogger();

        const uninstallA = installProcessHandlers(a, { proc, exit: jest.fn() });
        const uninstallB = installProcessHandlers(b, { proc, exit: jest.fn() });
        expect(uninstallB).not.toBe(uninstallA);
        expect(proc.listenerCount('SIGTERM')).toBe(2);

        uninstallA();
        expect(proc.listenerCount('SIGTERM')).toBe(1);
        uninstallB();
        expect(proc.listenerCount('SIGTERM')).toBe(0);
    });

    test('uninstalled handlers no longer react', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();

        installProcessHandlers(logger, { proc, exit })();
        proc.emit('SIGTERM');
        await tick();

        expect(logger.info).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });

    test('a logger without fatal falls back to error', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger(['error', 'warn', 'info']);

        const uninstall = installProcessHandlers(logger, { proc, exit, timeout: 500 });
        const err = new Error('no fatal here');
        proc.emit('uncaughtException', err, 'uncaughtException');
        await tick();

        expect(logger.error).toHaveBeenCalledWith('Uncaught exception', { err, origin: 'uncaughtException' });
        expect(exit).toHaveBeenCalledWith(1);
        uninstall();
    });

    test('a logger that throws while logging falls back to console.error and still exits', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = {
            fatal: jest.fn(() => { throw new Error('logger is dead'); }),
            error: jest.fn(() => { throw new Error('logger is dead'); }),
        };

        const uninstall = installProcessHandlers(logger, { proc, exit, timeout: 500 });
        proc.emit('uncaughtException', new Error('boom'), 'uncaughtException');
        await tick();

        expect(consoleError).toHaveBeenCalledWith('Uncaught exception', expect.objectContaining({ origin: 'uncaughtException' }));
        expect(exit).toHaveBeenCalledWith(1);
        uninstall();
    });

    test('a throwing onShutdown is logged and still exits', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();

        const uninstall = installProcessHandlers(logger, {
            proc,
            exit,
            timeout: 500,
            onShutdown: () => { throw new Error('hook exploded'); },
        });
        proc.emit('SIGTERM');
        await tick();

        expect(logger.error).toHaveBeenCalledWith('Shutdown hook failed', expect.objectContaining({ reason: 'SIGTERM' }));
        expect(exit).toHaveBeenCalledWith(0);
        uninstall();
    });

    test('a rejecting onShutdown is logged and still exits', async () => {
        const proc = makeProc();
        const exit = jest.fn();
        const logger = makeLogger();

        const uninstall = installProcessHandlers(logger, {
            proc,
            exit,
            timeout: 500,
            onShutdown: async () => { throw new Error('hook rejected'); },
        });
        proc.emit('SIGTERM');
        await tick();

        expect(logger.error).toHaveBeenCalledWith('Shutdown hook failed', expect.objectContaining({ reason: 'SIGTERM' }));
        expect(exit).toHaveBeenCalledWith(0);
        uninstall();
    });
});

describe('processHandlers - drainLogger', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('flushes a real pino logger writing to an in-memory destination', async () => {
        const pino = require('pino');
        const chunks = [];
        const logger = pino({ level: 'info' }, { write(chunk) { chunks.push(chunk); } });

        logger.info('drain me');
        await expect(drainLogger(logger, 1000)).resolves.toEqual({ drained: true });
        expect(chunks.join('')).toContain('drain me');
    });

    test('logs through the installed handlers with a real pino logger (object-first signature)', async () => {
        const pino = require('pino');
        const chunks = [];
        const logger = pino({ level: 'info' }, { write(chunk) { chunks.push(chunk); } });
        const proc = makeProc();
        const exit = jest.fn();

        const uninstall = installProcessHandlers(logger, { proc, exit, timeout: 500 });
        proc.emit('uncaughtException', new Error('pino boom'), 'uncaughtException');
        await tick();

        const line = JSON.parse(chunks.join('').trim().split('\n')[0]);
        expect(line.msg).toBe('Uncaught exception');
        expect(line.err.message).toBe('pino boom');
        expect(line.origin).toBe('uncaughtException');
        expect(exit).toHaveBeenCalledWith(1);
        uninstall();
    });

    test('resolves for a logger that has no flush or close', async () => {
        await expect(drainLogger({}, 1000)).resolves.toEqual({ drained: true });
        await expect(drainLogger(null, 1000)).resolves.toEqual({ drained: true });
    });

    test('awaits a promise-returning flush (ntlogger Winston path)', async () => {
        let resolved = false;
        const logger = { flush: () => Promise.resolve().then(() => { resolved = true; }) };
        await expect(drainLogger(logger, 1000)).resolves.toEqual({ drained: true });
        expect(resolved).toBe(true);
    });

    test('falls back to close() when flush is unavailable', async () => {
        const close = jest.fn(async () => {});
        await expect(drainLogger({ close }, 1000)).resolves.toEqual({ drained: true });
        expect(close).toHaveBeenCalledTimes(1);
    });

    test('reports the error when flush rejects', async () => {
        const failure = new Error('flush failed');
        const result = await drainLogger({ flush: () => Promise.reject(failure) }, 1000);
        expect(result.drained).toBe(false);
        expect(result.error).toBe(failure);
    });

    test('reports the error when flush throws synchronously', async () => {
        const result = await drainLogger({ flush() { throw new Error('sync boom'); } }, 1000);
        expect(result.drained).toBe(false);
        expect(result.error.message).toBe('sync boom');
    });

    test('surfaces a callback error from a pino-style flush', async () => {
        const failure = new Error('sonic boom');
        const result = await drainLogger({ flush: cb => setImmediate(() => cb(failure)) }, 1000);
        expect(result.drained).toBe(false);
        expect(result.error).toBe(failure);
    });

    test('resolves { drained: false } within the timeout when flush never calls back', async () => {
        jest.useFakeTimers();
        const pending = drainLogger({ flush(cb) { /* never calls back */ } }, 50);
        await jest.advanceTimersByTimeAsync(50);
        const result = await pending;
        expect(result.drained).toBe(false);
        expect(result.error.message).toContain('timed out after 50ms');
    });

    test('resolves immediately when there is no budget left', async () => {
        const flush = jest.fn();
        const result = await drainLogger({ flush }, 0);
        expect(result.drained).toBe(false);
        expect(flush).not.toHaveBeenCalled();
    });
});
