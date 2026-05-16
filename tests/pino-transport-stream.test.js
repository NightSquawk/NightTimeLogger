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
        stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((line) => {
            writes.push(typeof line === 'string' ? line : line.toString());
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
