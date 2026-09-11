jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const MySQL = require('../../plugins/mysql').transport;
const Postgres = require('../../plugins/postgres').transport;
const { EventEmitter } = require('events');

const write = (transport, info) => new Promise((resolve, reject) => {
    transport.log(info, error => error ? reject(error) : resolve());
});

describe.each([
    ['MySQL', MySQL, mysql.createPool, 'execute'],
    ['Postgres', Postgres, Pool, 'query'],
])('%s destination isolation', (name, Class, create, method) => {
    let pools;
    beforeEach(() => {
        pools = [];
        create.mockImplementation(config => {
            const pool = new EventEmitter();
            pool.config = config;
            pool[method] = jest.fn(async () => ({}));
            pool.end = jest.fn(async () => {});
            pools.push(pool);
            return pool;
        });
    });

    test('each destination initializes its own table and owns its pool', async () => {
        const a = new Class({ database: 'tenant_a', table: 'first' });
        const b = new Class({ database: 'tenant_b', table: 'second' });
        await Promise.all([a.ready, b.ready]);
        await a.close();
        await write(b, { level: 'info', message: 'for tenant B' });
        expect(pools).toHaveLength(2);
        expect(pools[1].config.database).toBe('tenant_b');
        expect(pools[1][method].mock.calls[0][0]).toContain('second');
        expect(pools[0][method].mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
        expect(pools[1][method].mock.calls.at(-1)[0]).toContain('INSERT INTO second');
        expect(pools[1].end).not.toHaveBeenCalled();
        await Promise.all([b.close(), b.close()]);
        expect(pools[1].end).toHaveBeenCalledTimes(1);
    });

    test('uses event timestamp rather than logger creation time and forwards TLS settings', async () => {
        const ssl = { rejectUnauthorized: true, ca: 'test-ca' };
        const transport = new Class({ ssl, waitForConnections: false, enableKeepAlive: false });
        await write(transport, { level: 'info', message: 'now', timestamp: '2026-09-10T20:10:12.345Z', timeCreated: '01:00:00 AM' });
        const params = pools[0][method].mock.calls.at(-1)[1];
        expect(params[3]).toContain('20:10:12.345');
        expect(pools[0].config.ssl).toBe(ssl);
        if (name === 'MySQL') {
            expect(pools[0].config.waitForConnections).toBe(false);
            expect(pools[0].config.enableKeepAlive).toBe(false);
        }
        await transport.close();
    });

    test('initialization and serialization failures reach callbacks and cleanup still works', async () => {
        const transport = new Class();
        await transport.ready;
        const meta = {}; meta.self = meta;
        await expect(write(transport, { level: 'info', message: 'bad meta', meta })).rejects.toThrow();
        await expect(transport.flush()).rejects.toThrow();
        await transport.close();
        expect(pools[0].end).toHaveBeenCalled();
    });

    test('rejects SQL fragments in table names before connecting', () => {
        expect(() => new Class({ table: 'logs; DROP TABLE users' })).toThrow('identifier');
        expect(pools).toHaveLength(0);
    });
});
