/**
 * @file /tests/plugins/syslogClient.test.js
 * @description Tests for plugins/lib/syslogClient.js using a local dgram UDP listener.
 *              Pure formatting paths (formatMessage / formatStructuredData) are exercised
 *              directly. The TCP/TLS connect paths are smoke-tested for transport construction
 *              but not connected over the wire to avoid flakiness.
 */

const dgram = require('dgram');
const SyslogClient = require('../../plugins/lib/syslogClient');

function startUdpListener() {
    return new Promise((resolve, reject) => {
        const server = dgram.createSocket('udp4');
        const received = [];
        server.on('message', (buf) => received.push(buf.toString()));
        server.on('error', reject);
        server.bind(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port, received });
        });
    });
}

function waitForMessage(received, timeoutMs = 500) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            if (received.length > 0) return resolve(received[0]);
            if (Date.now() - start > timeoutMs) return reject(new Error('No UDP packet received'));
            setTimeout(tick, 10);
        };
        tick();
    });
}

describe('SyslogClient', () => {
    describe('constructor defaults', () => {
        test('UDP is the default protocol', () => {
            const c = new SyslogClient();
            expect(c.protocol).toBe('UDP');
            expect(c.rfc).toBe('RFC-5424');
            expect(c.port).toBe(514);
            expect(c.appName).toBe('NTLogger');
            expect(c.transport).toBeDefined();
            c.close();
        });

        test('TCP protocol uses a net.Socket transport', () => {
            const c = new SyslogClient({ protocol: 'TCP' });
            expect(c.protocol).toBe('TCP');
            // Don't connect — just verify the transport shape
            expect(c.transport).toBeDefined();
            expect(typeof c.transport.connect).toBe('function');
            c.transport.destroy();
        });

        test('TLS protocol uses a tls.TLSSocket transport', () => {
            const c = new SyslogClient({ protocol: 'TLS' });
            expect(c.protocol).toBe('TLS');
            expect(c.transport).toBeDefined();
            c.transport.destroy();
        });
    });

    describe('formatMessage', () => {
        test('RFC-3164 produces priority + timestamp + hostname + appName + message', () => {
            const c = new SyslogClient({ rfc: 'RFC-3164', facility: 1, hostname: 'h', appName: 'App' });
            const out = c.formatMessage(6, 'hello world', {});
            // priority = facility*8 + severity = 1*8+6 = 14
            expect(out).toMatch(/^<14>/);
            expect(out).toContain('h App: hello world');
            c.close();
        });

        test('RFC-5424 produces structured data placeholder when none provided', () => {
            const c = new SyslogClient({ rfc: 'RFC-5424', facility: 1, hostname: 'h', appName: 'App' });
            const out = c.formatMessage(3, 'oh no', {});
            // priority = 1*8+3 = 11
            expect(out).toMatch(/^<11>1 /);
            expect(out).toContain('h App - - - oh no');
            c.close();
        });

        test('RFC-5424 emits structured data block when meta.structuredData is provided', () => {
            const c = new SyslogClient({ rfc: 'RFC-5424', facility: 1, hostname: 'h', appName: 'App' });
            const out = c.formatMessage(6, 'logged in', {
                structuredData: {
                    'auth@123': { user: 'alice', method: 'pw' },
                },
            });
            expect(out).toContain('[auth@123 user="alice" method="pw"]');
            c.close();
        });
    });

    describe('formatStructuredData', () => {
        test('empty map produces "-"', () => {
            const c = new SyslogClient();
            expect(c.formatStructuredData({})).toBe('-');
            c.close();
        });

        test('multiple SD-IDs are concatenated', () => {
            const c = new SyslogClient();
            const out = c.formatStructuredData({
                'a@1': { x: '1' },
                'b@2': { y: '2' },
            });
            expect(out).toContain('[a@1 x="1"]');
            expect(out).toContain('[b@2 y="2"]');
            c.close();
        });
    });

    describe('UDP send', () => {
        let listener;

        beforeEach(async () => {
            listener = await startUdpListener();
        });

        afterEach(() => {
            listener.server.close();
        });

        test('delivers an RFC-5424 formatted packet to the listener', async () => {
            const client = new SyslogClient({
                host: '127.0.0.1',
                port: listener.port,
                protocol: 'UDP',
                rfc: 'RFC-5424',
                facility: 1,
                appName: 'NTL-test',
                hostname: 'unit',
            });

            client.send(6, 'hello over udp', {});
            const packet = await waitForMessage(listener.received);

            expect(packet).toMatch(/^<14>1 /);
            expect(packet).toContain('unit NTL-test - - - hello over udp');
            client.close();
        });

        test('RFC-3164 packets carry the legacy format', async () => {
            const client = new SyslogClient({
                host: '127.0.0.1',
                port: listener.port,
                protocol: 'UDP',
                rfc: 'RFC-3164',
                facility: 4,
                appName: 'NTL-test',
                hostname: 'unit',
            });

            client.send(3, 'legacy message', {});
            const packet = await waitForMessage(listener.received);

            // priority = 4*8+3 = 35
            expect(packet).toMatch(/^<35>/);
            expect(packet).toContain('unit NTL-test: legacy message');
            client.close();
        });
    });

    describe('close', () => {
        test('UDP close does not throw', () => {
            const c = new SyslogClient({ protocol: 'UDP' });
            expect(() => c.close()).not.toThrow();
        });

        test('TCP close calls .end() on the socket', () => {
            const c = new SyslogClient({ protocol: 'TCP' });
            const endSpy = jest.spyOn(c.transport, 'end').mockImplementation(() => {});
            c.close();
            expect(endSpy).toHaveBeenCalled();
            c.transport.destroy();
        });
    });
});
