/**
 * @file /tests/base.test.js
 * @description Test the base functionality of the logger
 */
const logger = require('../lib/logger');

describe('Logger Base Tests', () => {
    let log;
    let jestTransport;

    const config = {
        level: 'internal',
        console: true,
        file: false,
        plugins: [{name: 'Jest',config: {}}],
    };

    const nameApp = 'Logger Base Tests';

    beforeEach(() => {
        // Create a new logger instance with the given configuration
        log = logger(nameApp, config);

        // Access the JestTransport instance
        jestTransport = log.transports.find(transport => transport.name === 'JestTransport');

        // Clear in-memory logs before each test
        jestTransport.clearMessages();
    });

    test('should log info message and store in memory', () => {
        log.info('Informational message');

        const logMessages = jestTransport.getMessages('info');

        // Verify the message is stored in memory
        expect(logMessages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    level: 'info',
                    message: 'Informational message',
                }),
            ])
        );
    });

    test('should log warning message and store in memory', () => {
        log.warn('Warning message');

        const logMessages = jestTransport.getMessages('warn');

        // Verify the message is stored in memory
        expect(logMessages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    level: 'warn',
                    message: 'Warning message',
                }),
            ])
        );
    });

    test('should log error message and store in memory', () => {
        log.error('Error message');

        const logMessages = jestTransport.getMessages('error');

        // Verify the message is stored in memory
        expect(logMessages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    level: 'error',
                    message: 'Error message',
                }),
            ])
        );
    });

    test('should log internal message and store in memory', () => {
        log.internal('Internal message');

        const logMessages = jestTransport.getMessages('internal');

        // Verify the message is stored in memory
        expect(logMessages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    level: 'internal',
                    message: 'Internal message',
                }),
            ])
        );
    });
});