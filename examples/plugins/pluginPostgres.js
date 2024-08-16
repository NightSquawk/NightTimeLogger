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
            name: 'Postgres',
            config: {
                host: process.env.POSTGRES_DB_HOST          || 'localhost',
                port: process.env.POSTGRES_DB_PORT          ||  5432,
                user: process.env.POSTGRES_DB_USER          || 'root',
                password: process.env.POSTGRES_DB_PASSWORD  || '',
                database: process.env.POSTGRES_DB_NAME      || 'test',
                table: process.env.POSTGRES_DB_TABLE        || 'logs',
                logLevel: process.env.LOG_LEVEL             || 'info',
            },
        }
    ],
}

// Create a logger instance
const log = logger('Plugin Example - Postgres', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
