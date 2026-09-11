const { setupSignalHandlers } = require('../lib/signalHandler');
const { spawnSync } = require('child_process');
const path = require('path');

const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'uncaughtException', 'unhandledRejection'];

describe('opt-in signal shutdown', () => {
    let uninstall;
    let exit;
    beforeEach(() => {
        exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { uninstall?.(); jest.restoreAllMocks(); });

    test.each(signals)('%s waits for delivery before exiting', async signal => {
        const close = jest.fn(() => new Promise(resolve => setTimeout(resolve, 20)));
        uninstall = setupSignalHandlers(new Set([{ close }]));
        const handler = process.listeners(signal).at(-1);
        const finished = handler();
        expect(exit).not.toHaveBeenCalled();
        await finished;
        expect(close).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(signal.startsWith('SIG') ? 0 : 1);
    });

    test('bounds shutdown and reports a stuck transport', async () => {
        uninstall = setupSignalHandlers(new Set([{ close: () => new Promise(() => {}) }]), { timeout: 20 });
        await process.listeners('SIGTERM').at(-1)();
        expect(exit).toHaveBeenCalledWith(1);
    });

    test('repeated signals share one cleanup', async () => {
        const close = jest.fn(async () => {});
        uninstall = setupSignalHandlers(new Set([{ close }]));
        await Promise.all([process.listeners('SIGTERM').at(-1)(), process.listeners('SIGINT').at(-1)()]);
        expect(close).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
    });

    test('import installs no handlers and opt-in delivers before process exit', () => {
        const result = spawnSync(process.execPath, ['-e', `
            const before = process.listenerCount('SIGTERM');
            const factory = require('./');
            if (before !== process.listenerCount('SIGTERM')) throw Error('side effect');
            const Transport = require('winston-transport');
            const log = factory('shutdown', { console: false, file: false });
            log.add(new Transport({ log(info, callback) {
                setTimeout(() => { console.log('DELIVERED'); callback(); }, 30);
            } }));
            factory.setupSignalHandlers();
            log.error('last message');
            process.emit('SIGTERM');
        `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 3000 });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('DELIVERED');
    });
});
