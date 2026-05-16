/**
 * @file /tests/plugins/postgres.test.js
 * @description Integration tests for the Postgres plugin against a real Postgres
 *              server spun up via testcontainers. Skipped when Docker is unavailable.
 */

const { describeIfDocker } = require('../helpers/dockerAvailable');

describeIfDocker('Postgres plugin (testcontainers)', () => {
    const { PostgreSqlContainer } = require('@testcontainers/postgresql');
    const { Pool } = require('pg');

    let container;
    let transport;
    let PostgreSQLTransport;
    let probePool;

    const TEST_DATABASE = 'ntlogger_test';
    const TEST_TABLE = 'logs';

    beforeAll(async () => {
        container = await new PostgreSqlContainer()
            .withDatabase(TEST_DATABASE)
            .withUsername('test')
            .withPassword('test')
            .start();

        jest.resetModules();
        PostgreSQLTransport = require('../../plugins/postgres').transport;

        probePool = new Pool({
            host: container.getHost(),
            port: container.getPort(),
            user: 'test',
            password: 'test',
            database: TEST_DATABASE,
        });
    }, 180000);

    afterAll(async () => {
        if (transport && typeof transport.close === 'function') {
            await transport.close().catch(() => {});
        }
        if (probePool) await probePool.end();
        if (container) await container.stop();
    }, 60000);

    const makeTransport = () => new PostgreSQLTransport({
        host: container.getHost(),
        port: container.getPort(),
        user: 'test',
        password: 'test',
        database: TEST_DATABASE,
        table: TEST_TABLE,
        level: 'internal',
    });

    test('creates the log table on first use', async () => {
        transport = makeTransport();
        await transport.checkLogTable();

        const res = await probePool.query(
            "SELECT to_regclass($1) AS t",
            [TEST_TABLE],
        );
        expect(res.rows[0].t).toBe(TEST_TABLE);
    });

    test('inserts a row when log() is called', async () => {
        const cb = jest.fn();
        transport.log({ level: 'info', message: 'hello-from-pg', userId: 11 }, cb);

        let row;
        for (let i = 0; i < 50; i++) {
            // eslint-disable-next-line no-await-in-loop
            const res = await probePool.query(
                `SELECT level, message, meta FROM ${TEST_TABLE} WHERE message = $1 ORDER BY id DESC LIMIT 1`,
                ['hello-from-pg'],
            );
            if (res.rows.length > 0) { row = res.rows[0]; break; }
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, 50));
        }

        expect(row).toBeDefined();
        expect(row.level).toBe('info');
        expect(row.meta.userId).toBe(11);
    });

    test('respects the configured level filter', async () => {
        const t = new PostgreSQLTransport({
            host: container.getHost(),
            port: container.getPort(),
            user: 'test',
            password: 'test',
            database: TEST_DATABASE,
            table: TEST_TABLE,
            level: 'error',
        });

        const cb = jest.fn();
        t.log({ level: 'debug', message: 'pg-dropped-by-filter' }, cb);
        await new Promise(r => setTimeout(r, 100));

        const res = await probePool.query(
            `SELECT COUNT(*)::int AS count FROM ${TEST_TABLE} WHERE message = $1`,
            ['pg-dropped-by-filter'],
        );
        expect(res.rows[0].count).toBe(0);
    });
});
