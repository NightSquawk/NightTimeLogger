// Import the logger
const logger = require('../lib/logger');

// Create a logger instance
const log = logger('MyApp');

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
