/**
 * @file /tests/pino-transport-stream.test.js
 * @description Exercises the actual split2 stream wrapper exported by
 *              transports/pino.js — formatLine is already covered separately.
 */

'use strict';

const transportFactory = require('../transports/pino');

describe('Pino transport stream', () => {
    let writes;
    let stdoutSpy;

    beforeEach(() => {
        writes = [];
        stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((line, callback) => {
            writes.push(typeof line === 'string' ? line : line.toString());
            if (typeof callback === 'function') callback();
            return true;
        });
    });

    afterEach(() => {
        stdoutSpy.mockRestore();
    });

    const drain = (stream) => new Promise((resolve) => {
        stream.end(() => resolve());
    });

    test('formats a valid Pino JSON line and writes to stdout', async () => {
        const stream = transportFactory({ defaultModule: 'TestApp' });
        stream.write(JSON.stringify({
            level: 30,
            time: Date.now(),
            msg: 'hello pino',
        }) + '\n');
        await drain(stream);

        const joined = writes.join('');
        expect(joined).toContain('[info    ]');
        expect(joined).toContain('hello pino');
        expect(joined).toContain('TestApp');
    });

    test('passes malformed JSON through unchanged', async () => {
        const stream = transportFactory();
        stream.write('not-json-at-all\n');
        await drain(stream);

        const joined = writes.join('');
        expect(joined).toContain('not-json-at-all');
    });

    test('pairs request-start and completion lines across the stream', async () => {
        const stream = transportFactory({ defaultModule: 'API', colorize: false });
        stream.write(JSON.stringify({
            level: 30,
            time: Date.now(),
            msg: 'incoming request',
            reqId: 'stream-1',
            req: { method: 'GET', url: '/api/v1/health' },
        }) + '\n');
        stream.write(JSON.stringify({
            level: 30,
            time: Date.now(),
            msg: 'request completed',
            reqId: 'stream-1',
            res: { statusCode: 200 },
            responseTime: 3.21,
        }) + '\n');
        await drain(stream);

        const joined = writes.join('');
        expect(joined).toContain('GET /api/v1/health');
        expect(joined).toContain('GET /api/v1/health — 200 (3.2ms)');
    });

    test('each transport instance keeps its own in-flight map', async () => {
        const first = transportFactory({ colorize: false });
        first.write(JSON.stringify({
            level: 30, time: Date.now(), reqId: 'shared',
            req: { method: 'GET', url: '/first' },
        }) + '\n');
        await drain(first);

        const second = transportFactory({ colorize: false });
        second.write(JSON.stringify({
            level: 30, time: Date.now(), reqId: 'shared', msg: 'request completed',
            res: { statusCode: 200 }, responseTime: 1,
        }) + '\n');
        await drain(second);

        const joined = writes.join('');
        expect(joined).not.toContain('/first — 200');
        expect(joined).toContain('request completed — 200 (1.0ms)');
    });

    test('renders the structured context suffix through the stream', async () => {
        const stream = transportFactory({ defaultModule: 'API', colorize: false });
        stream.write(JSON.stringify({
            level: 30,
            time: Date.now(),
            msg: 'context line',
            tenantId: 't-42',
            correlationId: 'corr-7',
        }) + '\n');
        await drain(stream);

        const joined = writes.join('');
        expect(joined).toContain('{tenantId=t-42 correlationId=corr-7}');
        expect(joined).toContain('context line');
    });

    test('HTTP completion without req.method/url falls back to msg + status', () => {
        const { formatLine } = require('../transports/pino');
        const line = formatLine({
            level: 30,
            time: Date.now(),
            msg: 'incoming request',
            res: { statusCode: 204 },
            responseTime: 7.3,
        });
        expect(line).toContain('incoming request');
        expect(line).toContain('204');
        expect(line).toContain('7.3ms');
    });

    test('HTTP completion with no msg and no req renders status only', () => {
        const { formatLine } = require('../transports/pino');
        const line = formatLine({
            level: 30,
            time: Date.now(),
            res: { statusCode: 500 },
            responseTime: 100,
        });
        expect(line).toContain('500');
        expect(line).toContain('100.0ms');
    });
});

test('colorize false strips ANSI formatting', () => {
    const formatted = transportFactory.formatLine({ time: Date.now(), level: 30, msg: 'plain text' }, { colorize: false });
    expect(formatted).not.toContain('\x1b[');
    expect(formatted).toContain('plain text');
});
