'use strict';

const { withTimeout } = require('./lifecycle');

// Explicit opt-in: importing a library must not install process exit handlers.
function setupSignalHandlers(loggerInstances, { timeout = 30000 } = {}) {
    let shuttingDown;
    const shutdown = (code, reason) => {
        if (shuttingDown) return shuttingDown;
        if (reason) console.error(reason);
        shuttingDown = (async () => {
            try {
                const loggers = [...new Set(loggerInstances.values())];
                await withTimeout(Promise.all(loggers.map(logger => logger.close())), timeout, 'Logger shutdown');
            } catch (error) {
                console.error('Logger shutdown failed:', error);
                code = 1;
            }
            process.exit(code);
        })();
        return shuttingDown;
    };
    const handlers = {
        SIGINT: () => shutdown(0),
        SIGTERM: () => shutdown(0),
        SIGQUIT: () => shutdown(0),
        uncaughtException: error => shutdown(1, error),
        unhandledRejection: reason => shutdown(1, reason),
    };
    for (const [event, handler] of Object.entries(handlers)) process.on(event, handler);
    return () => {
        for (const [event, handler] of Object.entries(handlers)) process.removeListener(event, handler);
    };
}

module.exports = { setupSignalHandlers };
