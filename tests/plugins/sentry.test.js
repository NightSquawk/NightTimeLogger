/**
 * @file /tests/plugins/sentry.test.js
 * @description Tests the Sentry plugin by mocking the @sentry/node module at the SDK boundary.
 *              We rely on @sentry/node maintainers to track upstream wire-protocol changes;
 *              our test surface is the interface between our transport and the SDK.
 */

jest.mock('@sentry/node', () => ({
    init: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
}));

const Sentry = require('@sentry/node');
const { transport: SentryTransport } = require('../../plugins/sentry');

describe('Sentry plugin', () => {
    beforeEach(() => {
        Sentry.init.mockReset();
        Sentry.captureException.mockReset();
        Sentry.captureMessage.mockReset();
    });

    test('initializes Sentry SDK with provided config on construction', () => {
        new SentryTransport({ dsn: 'https://example@sentry.test/1', environment: 'test' });
        expect(Sentry.init).toHaveBeenCalledTimes(1);
        const call = Sentry.init.mock.calls[0][0];
        expect(call.dsn).toBe('https://example@sentry.test/1');
        expect(call.environment).toBe('test');
    });

    test('routes error-level logs to captureException', () => {
        const t = new SentryTransport({ dsn: 'https://example@sentry.test/1' });
        const cb = jest.fn();
        t.log({ level: 'error', message: 'boom', userId: 7 }, cb);

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [err, ctx] = Sentry.captureException.mock.calls[0];
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('boom');
        expect(ctx.extra.userId).toBe(7);
        expect(cb).toHaveBeenCalled();
    });

    test('routes non-error logs to captureMessage with level + extra', () => {
        const t = new SentryTransport({ dsn: 'https://example@sentry.test/1' });
        const cb = jest.fn();
        t.log({ level: 'warn', message: 'careful', region: 'us-east' }, cb);

        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        const [msg, ctx] = Sentry.captureMessage.mock.calls[0];
        expect(msg).toBe('careful');
        expect(ctx.level).toBe('warn');
        expect(ctx.extra.region).toBe('us-east');
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    test('init errors are caught and surfaced via console.error', () => {
        Sentry.init.mockImplementationOnce(() => { throw new Error('bad dsn'); });
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => new SentryTransport({ dsn: 'not-real' })).not.toThrow();
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });

    test('exposes a sensible transport name', () => {
        const t = new SentryTransport({ dsn: 'https://example@sentry.test/1' });
        expect(t.name).toMatch(/Sentry/);
    });
});
