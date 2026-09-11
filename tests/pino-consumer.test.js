const { spawnSync } = require('child_process');
const path = require('path');

test('real Pino worker transport formats and drains before exit', () => {
    const result = spawnSync(process.execPath, ['-e', `
        const pino = require('pino');
        const transport = pino.transport({ target: require.resolve('./pino'), options: { colorize: false } });
        transport.on('ready', () => {
            const logger = pino({}, transport);
            logger.info('pino worker delivered');
            transport.end();
        });
    `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 5000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pino worker delivered');
    expect(result.stdout).not.toContain('\x1b[');
});
