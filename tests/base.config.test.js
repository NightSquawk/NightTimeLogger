/**
 * @file /tests/base.config.test.js
 * @description Test the base configuration of the logger
 */

const logger = require('../lib/logger')

describe('Logger Base Config Tests', () => {
    let log;
    let jestTransport;

    const config = {
        console: true,
        file: false,
        skipCache: true,
        plugins: [{name: 'Jest', enabled: true, config: {}}],
    };

    const nameApp = 'Logger Base Config Tests';

    const levels = [
        'fatal',
        'error',
        'warn',
        'info',
        'debug',
        'trace',
        'internal'
    ];

    levels.forEach((level, index) => {
        test(`should respect log level configuration - ${level}`, () => {
            const tconfig = { ...config, level };
            log = logger(nameApp, tconfig);

            // Ensure logger level is set correctly
            expect(log.level).toBe(level);

            jestTransport = log.transports.find(transport => transport.name === 'JestTransport');
            jestTransport.clearMessages();

            log.internal(`Internal message - Current level: ${level}`);
            log.trace(`Trace message - Current level: ${level}`);
            log.debug(`Debug message - Current level: ${level}`);
            log.info(`Info message - Current level: ${level}`);
            log.warn(`Warn message - Current level: ${level}`);
            log.error(`Error message - Current level: ${level}`);
            log.fatal(`Fatal message - Current level: ${level}`);

            const allMessages = jestTransport.getMessages();

            // Expect messages at or above the current level to be logged
            levels.slice(0, index + 1).forEach(expectedLevel => {
                const messageExists = allMessages.some(msg => msg.level === expectedLevel);
                expect(messageExists).toBe(true);
            });

            // Expect messages below the current level not to be logged
            levels.slice(index + 1).forEach(nonExpectedLevel => {
                const messageExists = allMessages.some(msg => msg.level === nonExpectedLevel);
                expect(messageExists).toBe(false);
            });
        });
    });
});
