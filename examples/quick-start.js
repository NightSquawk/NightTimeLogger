// Import the logger
const logger = require('ntlogger');

// Show every level without creating log files.
const log = logger('MyApp', { level: 'internal', file: false });

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
