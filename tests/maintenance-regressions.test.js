const createLogger = require('../');
const Transport = require('winston-transport');
const fs = require('fs');
const os = require('os');
const path = require('path');

const make = (options = {}) => createLogger(`regression-${Math.random()}`, {
    console: false, file: false, skipCache: true, ...options,
});

describe('delivery and logger lifecycle regressions', () => {
    const loggers = [];
    const logger = opts => { const value = make(opts); loggers.push(value); return value; };
    afterEach(async () => { await Promise.allSettled(loggers.splice(0).map(log => log.close())); });

    test('flush drains queued records through a slow transport and remains reusable', async () => {
        const log = logger();
        const received = [];
        log.add(new Transport({ highWaterMark: 1, log(info, cb) {
            setTimeout(() => { received.push(info.message); cb(); }, 3);
        } }));
        for (let i = 0; i < 50; i++) log.info(`message ${i}`);
        await log.flush();
        expect(received).toEqual(Array.from({ length: 50 }, (_, i) => `message ${i}`));
        log.info('still open');
        await log.flush();
        expect(received.at(-1)).toBe('still open');
    });

    test.each(['throw', 'reject'])('flush propagates a transport %s to its caller', async mode => {
        const log = logger();
        const t = new Transport({ log(info, cb) { cb(); } });
        t.flush = mode === 'throw' ? () => { throw new Error('delivery failed'); }
            : () => Promise.reject(new Error('delivery failed'));
        log.add(t);
        await expect(log.flush()).rejects.toThrow('delivery failed');
    });

    test('close awaits asynchronous cleanup exactly once', async () => {
        const log = logger();
        let closed = false;
        const close = jest.fn(async () => { await new Promise(r => setTimeout(r, 20)); closed = true; });
        log.add(new Transport({ log(info, cb) { cb(); }, close }));
        log.info('pending');
        await Promise.all([log.close(), log.close()]);
        expect(closed).toBe(true);
        expect(close).toHaveBeenCalledTimes(1);
    });

    test('a closed cached location creates a usable replacement', async () => {
        const location = `cached-${Math.random()}`;
        const a = createLogger(location, { console: false, file: false });
        await a.close();
        const b = createLogger(location, { console: false, file: false });
        expect(b).not.toBe(a);
        await b.close();
    });

    test('skipCache does not replace an existing cached logger', async () => {
        const location = `cached-${Math.random()}`;
        const a = createLogger(location, { console: false, file: false });
        const b = createLogger(location, { console: false, file: false, skipCache: true });
        expect(createLogger(location)).toBe(a);
        await Promise.all([a.close(), b.close()]);
    });

    test('children share transports without closing their parent and preserve nested context', async () => {
        const log = logger();
        const received = [];
        const close = jest.fn();
        log.add(new Transport({ log(info, cb) { received.push(info); cb(); }, close }));
        const child = log.child({ requestId: 'a', userId: 1 }).child({ userId: 2 });
        expect(child.transports[0]).toBe(log.transports[0]);
        child.info('child', { extra: true });
        await child.close();
        expect(close).not.toHaveBeenCalled();
        log.info('parent');
        await log.flush();
        expect(received[0]).toMatchObject({ message: 'child', requestId: 'a', userId: 2, extra: true });
        expect(received[1].requestId).toBeUndefined();
    });

    test('preserves Error stack and stamps the event when logging is called', async () => {
        const log = logger();
        const received = [];
        log.add(new Transport({ log(info, cb) { received.push(info); cb(); } }));
        const error = new Error('original failure');
        const start = Date.now();
        log.error(error, { requestId: 7 });
        await log.flush();
        expect(received[0]).toMatchObject({ message: error.message, stack: error.stack, requestId: 7 });
        expect(Date.parse(received[0].timestamp)).toBeGreaterThanOrEqual(start);
    });

    test('statistics timer is cleared on close', async () => {
        const clear = jest.spyOn(global, 'clearInterval');
        const log = logger({ sampling: { info: 1 }, statsInterval: 10 });
        await log.close();
        expect(clear).toHaveBeenCalled();
        clear.mockRestore();
    });

    test('filename and timestamp options affect actual files and flush waits for writes', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntl-files-'));
        const log = logger({ file: true, path: directory, filename: 'chosen.log', timestamp: false });
        try {
            log.info('file delivery');
            await log.flush();
            const contents = fs.readFileSync(path.join(directory, 'chosen.log'), 'utf8');
            expect(contents).toContain('file delivery');
            expect(contents).toMatch(/^\[info/);
            await log.close();
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});
