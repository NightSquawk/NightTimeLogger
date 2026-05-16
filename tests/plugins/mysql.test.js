/**
 * @file /tests/plugins/mysql.test.js
 * @description Integration tests for the MySQL plugin against a real MySQL server
 *              spun up via testcontainers. Skips automatically when Docker is not
 *              available (e.g., sandbox runners) so the suite remains green locally
 *              while still running for real in CI.
 */

const { describeIfDocker } = require('../helpers/dockerAvailable');

describeIfDocker('MySQL plugin (testcontainers)', () => {
    const { MySqlContainer } = require('@testcontainers/mysql');
    const mysql = require('mysql2/promise');

    let container;
    let transport;
    let MySQLTransport;

    const TEST_DATABASE = 'ntlogger_test';
    const TEST_TABLE = 'logs';

    beforeAll(async () => {
        container = await new MySqlContainer()
            .withDatabase(TEST_DATABASE)
            .withUsername('test')
            .withUserPassword('test')
            .start();

        // Fresh module state — the plugin uses module-scoped state for the pool
        jest.resetModules();
        MySQLTransport = require('../../plugins/mysql').transport;
    }, 180000);

    afterAll(async () => {
        if (transport && typeof transport.close === 'function') {
            await transport.close().catch(() => {});
        }
        if (container) await container.stop();
    }, 60000);

    const makeTransport = () => new MySQLTransport({
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
        // checkLogTable runs inside init() which is fired in constructor; give it a tick
        for (let i = 0; i < 50 && !transport.pool; i++) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, 50));
        }
        // Wait for table to be created
        await transport.checkLogTable();

        const probe = await mysql.createConnection({
            host: container.getHost(),
            port: container.getPort(),
            user: 'test',
            password: 'test',
            database: TEST_DATABASE,
        });
        const [rows] = await probe.execute(
            'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
            [TEST_DATABASE, TEST_TABLE],
        );
        expect(rows[0].count).toBe(1);
        await probe.end();
    });

    test('inserts a row when log() is called', async () => {
        const cb = jest.fn();
        transport.log({ level: 'info', message: 'hello-from-mysql', userId: 7 }, cb);

        // The plugin's log() is async; wait for the row to land
        const probe = await mysql.createConnection({
            host: container.getHost(),
            port: container.getPort(),
            user: 'test',
            password: 'test',
            database: TEST_DATABASE,
        });

        let row;
        for (let i = 0; i < 50; i++) {
            // eslint-disable-next-line no-await-in-loop
            const [rows] = await probe.execute(
                `SELECT level, message, meta FROM ${TEST_TABLE} WHERE message = ? ORDER BY id DESC LIMIT 1`,
                ['hello-from-mysql'],
            );
            if (rows.length > 0) { row = rows[0]; break; }
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, 50));
        }
        await probe.end();

        expect(row).toBeDefined();
        expect(row.level).toBe('info');
        expect(JSON.parse(row.meta).userId).toBe(7);
    });

    test('respects the configured level filter', async () => {
        const t = new MySQLTransport({
            host: container.getHost(),
            port: container.getPort(),
            user: 'test',
            password: 'test',
            database: TEST_DATABASE,
            table: TEST_TABLE,
            level: 'error',
        });

        const cb = jest.fn();
        // info=3 > error=1 -> should be filtered (note: plugin uses lowest=fatal=0 numeric ordering)
        t.log({ level: 'debug', message: 'dropped-by-filter' }, cb);

        await new Promise(r => setTimeout(r, 100));

        const probe = await mysql.createConnection({
            host: container.getHost(),
            port: container.getPort(),
            user: 'test',
            password: 'test',
            database: TEST_DATABASE,
        });
        const [rows] = await probe.execute(
            `SELECT COUNT(*) AS count FROM ${TEST_TABLE} WHERE message = ?`,
            ['dropped-by-filter'],
        );
        await probe.end();

        expect(rows[0].count).toBe(0);
    });

    describe('formatTimestamp (pure)', () => {
        let inst;
        beforeAll(() => { inst = makeTransport(); });

        test('returns ISO-derived default when timeCreated is missing', () => {
            const out = inst.formatTimestamp(null);
            expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });

        test('converts PM hours to 24h (1:05:09 PM -> 13:05:09)', () => {
            const out = inst.formatTimestamp('01:05:09 PM');
            expect(out).toMatch(/ 13:05:09$/);
        });

        test('keeps 12:xx PM as 12:xx', () => {
            const out = inst.formatTimestamp('12:30:00 PM');
            expect(out).toMatch(/ 12:30:00$/);
        });

        test('converts 12:xx AM to 00:xx', () => {
            const out = inst.formatTimestamp('12:30:00 AM');
            expect(out).toMatch(/ 00:30:00$/);
        });
    });
});
