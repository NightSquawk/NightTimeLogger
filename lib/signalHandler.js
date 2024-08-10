/**
 * @file /lib/signalHandler.js
 * @description Initializes signal handlers for the application.
 */

function setupSignalHandlers(loggerInstances) {
    const cleanup = () => {
        console.log('Cleaning up logger resources...');
        for (const [location, logger] of loggerInstances) {
            logger.end(() => {
                console.log(`Logger for ${location} closed.`);
            });

            for (const transport of logger.transports) {
                if (transport.close) {
                    transport.close();
                }
            }
        }
    };

    process.on('SIGINT', () => {
        console.log('Received SIGINT. Exiting...');
        cleanup();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('Received SIGTERM. Exiting...');
        cleanup();
        process.exit(0);
    });

    process.on('SIGQUIT', () => {
        console.log('Received SIGQUIT. Exiting...');
        cleanup();
        process.exit(0);
    });

    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception:', err);
        cleanup();
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        cleanup();
        process.exit(1);
    });
}

module.exports = { setupSignalHandlers };
