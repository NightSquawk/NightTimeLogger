// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

// Configure the Logger
let config = {
    level: 'internal',
    file: false,
    console: true,
    plugins: [
        {
            name: 'OpenObserve',
            enabled: true,
            config: {
                // The URL of your OpenObserve server
                // Replace with your actual OpenObserve host (e.g., 'http://localhost:5080' or 'https://api.openobserve.ai')
                host: process.env.OPENOBSERVE_HOST || 'http://localhost:5080',

                // Your OpenObserve organization name
                organization: process.env.OPENOBSERVE_ORGANIZATION || 'default',

                // The stream name where logs will be sent
                stream: process.env.OPENOBSERVE_STREAM || 'logs',

                // Authentication credentials
                username: process.env.OPENOBSERVE_USERNAME || 'admin@ithelper.local',
                password: process.env.OPENOBSERVE_PASSWORD || 'qRPE6Rg2rQSXVPUu',

                // Optional: Number of logs to batch before sending (default: 100)
                // Batching improves performance by reducing the number of HTTP requests
                batchSize: 100,

                // Optional: Time in milliseconds before sending a batch (default: 5000)
                // Logs will be sent automatically after this time even if batchSize is not reached
                timeThreshold: 5000,

                // Optional: Minimum log level to send to OpenObserve (default: 'info')
                // Log levels (from highest to lowest severity):
                // 'fatal' (0) - Critical conditions
                // 'error' (1) - Error conditions
                // 'warn' (2) - Warning conditions
                // 'info' (3) - Informational messages
                // 'debug' (4) - Debug-level messages
                // 'trace' (5) - Trace-level messages
                // 'internal' (6) - Internal logger messages
                level: 'info',
            },
        },
    ],
}

// Create a logger instance
const log = logger('Plugin Example - OpenObserve', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');

// Log with metadata
log.info('User logged in', { userId: 12345, ip: '192.168.1.1' });
log.error('Database connection failed', { host: 'db.example.com', port: 5432 });

// Wait a bit to allow batching to complete, then exit
setTimeout(() => {
    console.log('Example completed. Check your OpenObserve instance for the logs.');
    process.exit(0);
}, 6000);

