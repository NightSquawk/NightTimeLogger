// Import the logger
const logger = require('ntlogger');

let config = {

    // Minimum log level to be logged
    // Levels: internal, trace, debug, info, warn, error, fatal
    // internal is the highest level, so, selecting internal will log all messages
    level: 'internal',

    // Enable console logging
    console: true, // default: true

    // Enable file logging
    file: true,

    // Path to the log file
    path: '/var/log/MyApp',

    // Maximum size of the log file in bytes
    maxSize: 1048576, // 1MB

    // Maximum number of log files to keep, this will create up to 5 files before overwriting the oldest
    // In total, you will have 5 combined.log files, 5 error.log files, and 5 fatal.log files
    // Named as combined1.log, combined2.log, combined3.log, combined4.log, combined5.log
    maxFiles: 5,

    // Include timestamp in the log message
    // TODO: Implement timestamp on/off switch in the log message
    timestamp: true,

    // This is for debugging purposes of the logger itself
    debug: false, // default: false
}

// Create a logger instance
// The logger instance is cached by the location
// A location is used to in the log message to identify where the log message is coming from
// It is a feature and its required as well
const log = logger(location="MyApp", config=config)

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
