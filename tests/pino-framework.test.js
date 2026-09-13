'use strict';

const Fastify = require('fastify');
const { AsyncLocalStorage } = require('node:async_hooks');
const { spawnSync } = require('node:child_process');
const { createPinoOptions, createTestLogger, isSilent } = require('../pino');

test('Fastify logs serialize intact requests and redact headers, bodies, errors and context', async () => {
    const records = [];
    const context = new AsyncLocalStorage();
    const app = Fastify({
        logger: {
            ...createPinoOptions({
                silent: false,
                service: 'api',
                contextProvider: () => context.getStore(),
                serializers: {
                    req(req) {
                        // Access to the original Fastify request, before deep cloning.
                        expect(typeof req.raw.on).toBe('function');
                        return { method: req.method, url: req.url, headers: req.headers };
                    },
                    res(reply) {
                        return { statusCode: reply.statusCode, headers: reply.getHeaders() };
                    },
                },
            }),
            stream: { write(line) { records.push(JSON.parse(line)); } },
        },
    });
    app.post('/scan', (req, reply) => context.run({ tenantId: 't1', token: 'context-secret' }, () => {
        req.log.info({ body: req.body }, 'scan started');
        req.log.error(new Error('password=error-secret'));
        reply.header('set-cookie', 'session=response-secret').send({ ok: true });
    }));
    try {
        const response = await app.inject({
            method: 'POST', url: '/scan',
            headers: { authorization: 'Bearer request-secret' },
            payload: { password: 'body-secret', deviceId: 'd1' },
        });
        expect(response.statusCode).toBe(200);
        const incoming = records.find(r => r.req);
        expect(incoming.req).toMatchObject({ method: 'POST', url: '/scan' });
        expect(incoming.req.headers.authorization).toBe('[REDACTED]');
        expect(records.find(r => r.body)).toMatchObject({
            service: 'api', tenantId: 't1', token: '[REDACTED]',
            body: { password: '[REDACTED]', deviceId: 'd1' },
        });
        expect(records.find(r => r.err).err.type).toBe('Error');
        expect(records.every(r => typeof r.reqId === 'string')).toBe(true);
        const output = JSON.stringify(records);
        for (const secret of ['request-secret', 'body-secret', 'context-secret', 'error-secret', 'response-secret']) {
            expect(output).not.toContain(secret);
        }
    } finally {
        await app.close();
    }
});

test('default Fastify serializers retain request/response fields', async () => {
    const records = [];
    const app = Fastify({ logger: {
        ...createPinoOptions({ silent: false }),
        stream: { write(line) { records.push(JSON.parse(line)); } },
    } });
    app.get('/', () => ({ ok: true }));
    try {
        await app.inject('/');
        expect(records.find(r => r.req).req).toMatchObject({ method: 'GET', url: '/' });
        expect(records.find(r => r.res).res.statusCode).toBe(200);
    } finally { await app.close(); }
});

test('options keep native path redaction and can disable redaction', () => {
    const pino = require('pino');
    const records = [];
    const destination = { write(line) { records.push(JSON.parse(line)); } };
    pino(createPinoOptions({ silent: false, redact: ['body.pin'] }), destination)
        .info({ body: { pin: '1234', password: 'secret' } });
    expect(records[0].body).toEqual({ pin: '[Redacted]', password: '[REDACTED]' });
    pino(createPinoOptions({ silent: false, redact: false }), destination)
        .info({ body: { password: 'visible' } });
    expect(records[1].body.password).toBe('visible');
    expect(() => createPinoOptions({ sampling: { info: 0.5 } })).toThrow(/createLogger/);
});

test('test logger captures serialized redacted records, child bindings and level filtering', async () => {
    const { logger, records } = createTestLogger({ level: 'info' });
    logger.debug('filtered');
    logger.child({ deviceId: 'd1', password: 'child-secret' }).warn({ token: 'secret' }, 'warning');
    logger.error(new Error('failed'));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ level: 40, deviceId: 'd1', password: '[REDACTED]', token: '[REDACTED]', msg: 'warning' });
    expect(records[1].err.type).toBe('Error');
    await logger.close();
    const quiet = createTestLogger({ silent: true });
    quiet.logger.info('invisible');
    expect(quiet.records).toEqual([]);
    await quiet.logger.close();
});

test('NODE_TEST_CONTEXT silence preserves explicit option and environment precedence', () => {
    const original = { ...process.env };
    try {
        process.env.NODE_ENV = 'production';
        process.env.NODE_TEST_CONTEXT = 'child-v8';
        delete process.env.NTLOGGER_SILENT;
        expect(isSilent()).toBe(true);
        expect(isSilent({ silent: false })).toBe(false);
        process.env.NTLOGGER_SILENT = '0';
        expect(isSilent()).toBe(false);
        process.env.NTLOGGER_SILENT = '1';
        expect(isSilent({ silent: false })).toBe(false);
        process.env.NODE_TEST_CONTEXT = '';
        delete process.env.NTLOGGER_SILENT;
        expect(isSilent()).toBe(false);
    } finally {
        process.env = original;
    }
});

test('real node --test child auto-silences and test helper still captures', () => {
    const env = { ...process.env };
    delete env.NODE_ENV;
    delete env.NTLOGGER_SILENT;
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', 'tests/fixtures/node-test-silence.cjs'], {
        cwd: require('path').join(__dirname, '..'), env, encoding: 'utf8', timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('SHOULD_NOT_EMIT');
});
