/**
 * @file /tests/plugins/syslog.test.js
 * @description Tests for the Syslog winston transport. The underlying SyslogClient
 *              has its own dedicated suite — here we focus on the transport's
 *              level filtering, level-to-severity mapping, and lifecycle methods.
 *
 *              CLAUDE.md flags "Syslog plugin has incorrect log level mappings" as a
 *              known issue — the level-mapping tests below pin down the current
 *              behavior so a future fix can update them deliberately.
 */

const dgram = require('dgram');
const { transport: SyslogTransport } = require('../../plugins/syslog');

function startUdpListener() {
    return new Promise((resolve) => {
        const server = dgram.createSocket('udp4');
        const received = [];
        server.on('message', (buf) => received.push(buf.toString()));
        server.bind(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port, received });
        });
    });
}

function waitFor(predicate, timeoutMs = 500) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error('Timed out'));
            setTimeout(tick, 10);
        };
        tick();
    });
}

describe('SyslogTransport', () => {
    let listener;

    beforeEach(async () => {
        listener = await startUdpListener();
    });

    afterEach(() => {
        listener.server.close();
    });

    test('UDP transport ships logs to the configured host/port', async () => {
        const t = new SyslogTransport({
            host: '127.0.0.1',
            port: listener.port,
            protocol: 'UDP',
            appName: 'AppName',
            hostname: 'hostname',
            level: 'info',
        });

        const cb = jest.fn();
        t.log({ level: 'info', message: 'shipped over wire' }, cb);

        await waitFor(() => listener.received.length > 0);
        expect(listener.received[0]).toContain('shipped over wire');
        expect(cb).toHaveBeenCalled();
        await t.close();
    });

    test('suppresses logs below configured level', async () => {
        const t = new SyslogTransport({
            host: '127.0.0.1',
            port: listener.port,
            protocol: 'UDP',
            level: 'error',
        });

        const cb = jest.fn();
        // info=6 is below error=3 in syslog severity — should be filtered
        t.log({ level: 'info', message: 'should be dropped' }, cb);

        // Give UDP a moment in case the test would have sent — it shouldn't have
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(listener.received.length).toBe(0);
        expect(cb).toHaveBeenCalled();
        await t.close();
    });

    test('maps fatal -> 2, error -> 3, warn -> 4, info -> 6, debug/trace/internal -> 7', () => {
        const t = new SyslogTransport({ host: '127.0.0.1', port: listener.port, level: 'internal' });
        expect(t.levels.fatal).toBe(2);
        expect(t.levels.error).toBe(3);
        expect(t.levels.warn).toBe(4);
        expect(t.levels.info).toBe(6);
        expect(t.levels.debug).toBe(7);
        expect(t.levels.trace).toBe(7);
        expect(t.levels.internal).toBe(7);
    });

    test('isActive reports true for an active UDP transport', () => {
        const t = new SyslogTransport({ host: '127.0.0.1', port: listener.port, protocol: 'UDP' });
        expect(t.isActive()).toBe(true);
    });
});
