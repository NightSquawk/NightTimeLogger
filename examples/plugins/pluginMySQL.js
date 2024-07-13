// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

const { nodeProfilingIntegration } = require("@sentry/profiling-node");

// Configure the Logger
let config = {
    level: process.env.LOG_LEVEL,
    file: false,
    plugins: [
        {
            name: 'MySQL',
            config: {
                host: process.env.MYSQL_DB_HOST || 'localhost',
                port: process.env.MYSQL_DB_PORT || 3306,
                user: process.env.MYSQL_DB_USER || 'root',
                password: process.env.MYSQL_DB_PASSWORD || '',
                database: process.env.MYSQL_DB_NAME || 'test',
                table: process.env.MYSQL_DB_TABLE || 'logs',

                logLevel: process.env.LOG_LEVEL || 'info',
            },
        }
    ],
}

// Create a logger instance
const log = logger('Plugin Example - MySQL', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
