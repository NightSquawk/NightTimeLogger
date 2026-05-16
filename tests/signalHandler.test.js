/**
 * @file /tests/signalHandler.test.js
 * @description Tests for setupSignalHandlers — verifies handler registration and cleanup behavior.
 */

const { setupSignalHandlers } = require('../lib/signalHandler');

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'uncaughtException', 'unhandledRejection'];

describe('signalHandler', () => {
    let originalListeners;
    let exitSpy;
    let logSpy;
    let errorSpy;

    beforeEach(() => {
        // Snapshot existing listeners so we can restore them after each test
        originalListeners = {};
        for (const sig of SIGNALS) {
            originalListeners[sig] = process.listeners(sig);
            process.removeAllListeners(sig);
        }
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const sig of SIGNALS) {
            process.removeAllListeners(sig);
            for (const listener of originalListeners[sig]) {
                process.on(sig, listener);
            }
        }
        exitSpy.mockRestore();
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test('registers a handler for every supported signal/event', () => {
        setupSignalHandlers(new Map());
        for (const sig of SIGNALS) {
            expect(process.listenerCount(sig)).toBeGreaterThanOrEqual(1);
        }
    });

    test('SIGINT handler closes cached loggers and exits 0', () => {
        const transportClose = jest.fn();
        const loggerEnd = jest.fn(cb => cb && cb());
        const fakeLogger = {
            end: loggerEnd,
            transports: [{ close: transportClose }, { /* no close */ }],
        };
        const cache = new Map([['LocA', fakeLogger]]);

        setupSignalHandlers(cache);
        const handler = process.listeners('SIGINT').slice(-1)[0];
        handler();

        expect(loggerEnd).toHaveBeenCalled();
        expect(transportClose).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('SIGTERM and SIGQUIT also exit 0 after cleanup', () => {
        setupSignalHandlers(new Map());

        process.listeners('SIGTERM').slice(-1)[0]();
        expect(exitSpy).toHaveBeenLastCalledWith(0);

        process.listeners('SIGQUIT').slice(-1)[0]();
        expect(exitSpy).toHaveBeenLastCalledWith(0);
    });

    test('uncaughtException handler logs error and exits 1', () => {
        setupSignalHandlers(new Map());
        const handler = process.listeners('uncaughtException').slice(-1)[0];
        const err = new Error('boom');
        handler(err);
        expect(errorSpy).toHaveBeenCalledWith('Uncaught Exception:', err);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('unhandledRejection handler logs reason and exits 1', () => {
        setupSignalHandlers(new Map());
        const handler = process.listeners('unhandledRejection').slice(-1)[0];
        const reason = new Error('nope');
        const promise = Promise.reject(reason).catch(() => {});
        handler(reason, promise);
        expect(errorSpy).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('cleanup tolerates transports without a close method', () => {
        const cache = new Map([
            ['NoClose', { end: cb => cb && cb(), transports: [{}] }],
        ]);
        setupSignalHandlers(cache);
        expect(() => process.listeners('SIGINT').slice(-1)[0]()).not.toThrow();
    });
});
