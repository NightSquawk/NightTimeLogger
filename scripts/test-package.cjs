'use strict';

// Deliberately separate from Jest: these checks use the registry and real packed installs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ntlogger-package-'));
const env = { ...process.env, NODE_ENV: 'production' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'NTLOGGER_SILENT']) delete env[key];

function run(command, args, cwd, extraEnv = {}) {
    const result = spawnSync(command, args, {
        cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 120000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}
function npm(args, cwd) {
    return process.env.npm_execpath
        ? run(process.execPath, [process.env.npm_execpath, ...args], cwd)
        : run('npm', args, cwd);
}
function consumer(name) {
    const cwd = path.join(temporary, name);
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name, private: true, version: '1.0.0' }));
    return cwd;
}
const assertMissing = `
    for (const id of ['winston', 'winston-transport']) {
        assert.throws(() => require.resolve(id), { code: 'MODULE_NOT_FOUND' });
    }
`;

try {
    npm(['pack', '--ignore-scripts', '--pack-destination', temporary], root);
    const archive = path.join(temporary, fs.readdirSync(temporary).find(name => name.endsWith('.tgz')));
    const pino = consumer('pino-consumer');
    const pinoVersion = process.env.NTLOGGER_TEST_PINO_VERSION || require('pino/package.json').version;
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive, `pino@${pinoVersion}`], pino);
    const output = run(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        ${assertMissing}
        assert.throws(() => require('ntlogger'), /npm install winston winston-transport/);
        const { createLogger, createTestLogger, createPinoOptions, withSecretValues } = require('ntlogger/pino');
        assert.ok(require('ntlogger/contract/redaction.json').keys.includes('community'));
        assert.ok(require('ntlogger/contract/conformance.json').levels.some(v => v.python === 5 && v.pino === 10));
        const seen = [];
        const log = createLogger({ service: 'satellite', context: { tenantId: 't1' }, onLog: r => seen.push(r) });
        log.info({ password: 'private-password', deviceId: 'd1' }, 'credential scan');
        assert.equal(seen[0].password, '[REDACTED]');
        assert.equal(log.getStats().levels.info, 1);
        assert.ok(require('ntlogger/eslint').rules['prefer-object-first']);
        const capture = createTestLogger();
        capture.logger.info({ token: 'private-token' }, 'captured');
        withSecretValues(['opaque-secret'], () => capture.logger.info('value %s', Buffer.from('opaque-secret')));
        assert.equal(capture.records[1].msg, 'value [REDACTED]');
        const bounded = createTestLogger({ onLogMaxPending: 0, onLog() { throw new Error('should be dropped'); } });
        bounded.logger.info('primary');
        assert.equal(bounded.logger.getStats().onLog.dropped, 1);
        bounded.logger.close();
        assert.equal(capture.records[0].token, '[REDACTED]');
        assert.equal(createPinoOptions({ service: 'api' }).base.service, 'api');
        Promise.all([log.close(), capture.logger.close()]).then(results => {
            assert.ok(results.every(result => result.drained));
            assert.throws(() => log.debug('closed'), /closed/);
        });
    `], pino);
    const record = JSON.parse(output.trim());
    assert.equal(record.password, '[REDACTED]');
    assert.equal(record.service, 'satellite');
    assert.equal(record.tenantId, 't1');
    assert.equal(record.deviceId, 'd1');
    console.log('PASS: packed Pino-only install, JSON redaction/context and test helpers');

    const pretty = run(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        ${assertMissing}
        const { createLogger } = require('ntlogger/pino');
        const log = createLogger({ module: 'Satellite', colorize: false });
        log.info('password=private-password');
        log.close().then(result => { assert.equal(result.drained, true); });
    `], pino, { NODE_ENV: 'development' });
    assert.ok(pretty.includes('[Satellite]'), pretty);
    assert.ok(pretty.includes('[REDACTED]'), pretty);
    assert.ok(!pretty.includes('private-password'), pretty);
    console.log('PASS: packed Pino-only development worker transport');

    npm(['install', '--save-dev', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund',
        `typescript@${require('typescript/package.json').version}`,
        `@types/node@${require('@types/node/package.json').version}`], pino);
    fs.writeFileSync(path.join(pino, 'consumer.ts'), `
        import { createLogger, createPinoOptions, createTestLogger } from 'ntlogger/pino';
        import type { LoggerOptions } from 'pino';
        const options: LoggerOptions = createPinoOptions({ service: 'satellite' });
        const log = createLogger({ context: { tenantId: 't1' } });
        log.child({ deviceId: 'd1' }).info('scan');
        createTestLogger().records.map(record => record.msg);
        void options;
    `);
    run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict',
        '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], pino);
    run(process.execPath, ['-e', `const assert = require('node:assert/strict'); ${assertMissing}`], pino);
    console.log('PASS: packed Pino TypeScript surface without Winston types');

    const winston = consumer('winston-consumer');
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive,
        `winston@${require('winston/package.json').version}`,
        `winston-transport@${require('winston-transport/package.json').version}`], winston);
    const winstonOutput = run(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        assert.throws(() => require.resolve('pino'), { code: 'MODULE_NOT_FOUND' });
        const log = require('ntlogger')('Consumer', { file: false, skipCache: true });
        log.info('Winston consumer delivered');
        log.close().catch(error => { console.error(error); process.exitCode = 1; });
    `], winston);
    assert.ok(winstonOutput.includes('Winston consumer delivered'), winstonOutput);
    console.log('PASS: packed Winston-only install and close without Pino');
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
