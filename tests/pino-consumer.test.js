'use strict';

/**
 * End-to-end checks that run the *real* Pino worker transport in a child
 * process. Everything that only needs the emitted JSON lives in
 * tests/pino-createLogger.test.js, which uses an in-process destination.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Run a snippet in a child process with the repo as cwd.
 * @param {string} source - JavaScript to evaluate.
 * @param {object} [env] - Extra environment variables.
 * @returns {object} - spawnSync result.
 */
function run(source, env = {}) {
    return spawnSync(process.execPath, ['-e', source], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 15000,
        env: Object.assign({}, process.env, env),
    });
}

test('real Pino worker transport formats and drains before exit', () => {
    const result = run(`
        const pino = require('pino');
        const transport = pino.transport({ target: require.resolve('./pino'), options: { colorize: false } });
        transport.on('ready', () => {
            const logger = pino({}, transport);
            logger.info('pino worker delivered');
            transport.end();
        });
    `);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pino worker delivered');
    expect(result.stdout).not.toContain('\x1b[');
});

test('createLogger in dev mode renders context and redacts through the worker transport', () => {
    const result = run(`
        const { AsyncLocalStorage } = require('async_hooks');
        const { createLogger } = require('./pino');
        const als = new AsyncLocalStorage();
        const log = createLogger({
            module: 'Worker',
            silent: false,
            colorize: false,
            contextProvider: () => als.getStore(),
            contextKeys: ['tenantId', 'correlationId'],
        });
        als.run({ tenantId: 'tenant-7', correlationId: 'corr-7', ignored: 'x' }, () => {
            log.info('secret is Bearer abcdefghijklmnop1234567890');
            log.error(new Error('worker failure'));
        });
        log.close(5000).then(() => process.exit(0));
    `, { NODE_ENV: 'development', LOG_LEVEL: 'debug' });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[Worker]');
    expect(result.stdout).toContain('{tenantId=tenant-7 correlationId=corr-7}');
    expect(result.stdout).not.toContain('ignored');
    expect(result.stdout).toContain('secret is Bearer [REDACTED]');
    expect(result.stdout).not.toContain('abcdefghijklmnop');
    expect(result.stdout).toContain('worker failure');
});

test('createLogger in dev mode is silent when NTLOGGER_SILENT is set', () => {
    const result = run(`
        const { createLogger } = require('./pino');
        const log = createLogger({ module: 'Quiet' });
        log.info('must not appear');
        log.fatal('must not appear either');
    `, { NODE_ENV: 'development', NTLOGGER_SILENT: '1' });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
});
