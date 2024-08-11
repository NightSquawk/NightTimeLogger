// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

// Configure the Logger
let config = {
    level: 'internal',
    file: false,
    plugins: [{name: 'Jest',config: {}}],
}

// Create a logger instance
const log = logger('Plugin Example - Jest', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');
log.internal('Internal message');

// Access the JestTransport instance to see captured logs
const jestTransport = log.transports.find(transport => transport.name === 'JestTransport');

// Retrieve all captured log messages
console.log(jestTransport.getMessages()); // Output all captured log messages

log.error('This is an error message');

// Retrieve only 'error' level log messages
console.log(jestTransport.getMessages('error'));
