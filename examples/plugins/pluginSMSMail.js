// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

let config = {
    level: 'info',
    file: false,
    plugins: [
        {
            name: 'SMSMail',
            enabled: true,
            config: {
                smsMailId: '', // Replace with the actual SMS email gateway address
                from: 'noreply@example.com',
                subjectPrefix: 'Critical Log',
                level: 'error',
                strict: true,
            },
        },
    ],
}

// Create a logger instance
const log = logger('Plugin Example - SMS', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');