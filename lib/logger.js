/**
 * NightTimeLogger: A Custom Ready-To-Go Logging Wrapper Built on Winston
 *
 * This utility is a customized wrapper around the Winston logging library.
 * It offers different log levels and formats and can be easily integrated into
 * any Node.js project.
 *
 * Author: Kevin R. (Kvrnn#6940, Syntax#5569)
 * License: GPL-3.0
 */

const winston = require('winston');
const crypto = require('crypto');

const { setupSignalHandlers } = require('./signalHandler');
const { initPlugins } = require('../plugins/index');
const { reportPath } = require('./pathReporter');
const { LogSampler } = require('./logSampler');
const { LogDeduplicator } = require('./logDeduplicator');
const { PerformanceTracker } = require('./performanceTracker');

const colors = require('./colors');
const levels = require('./levels');


// Define a map to hold the logger instances by their location
const loggerInstances = new Map();

// Call the signal handler setup function
setupSignalHandlers(loggerInstances);

const customSettings = {
    levels: levels,
    colors: colors.console,
};

const randomBrightColor = () => {
    // Configuration variables
    const minLuminanceThreshold = 0.03928;
    const linearConversionDivider = 12.92;
    const linearConversionBase = 1.055;
    const linearConversionExponent = 2.4;
    const luminanceCoefficients = { r: 0.2126, g: 0.7152, b: 0.0722 };
    // const minContrastRatio = 4.5; // WCAG AA standard for normal text
    const minContrastRatio = 2.5; // I like 2.5 will change if any issues arise

    // Helper function to convert sRGB to linear RGB
    const convertToLinear = (colorComponent) => {
        const scaledComponent = colorComponent / 255;
        return scaledComponent <= minLuminanceThreshold ? scaledComponent / linearConversionDivider
            : Math.pow((scaledComponent + 0.055) / linearConversionBase, linearConversionExponent);
    };

    while (true) {
        // Generate random RGB values
        const [red, green, blue] = [0, 1, 2].map(() => Math.floor(Math.random() * 256));

        // Convert to linear RGB values
        const [rLinear, gLinear, bLinear] = [red, green, blue].map(convertToLinear);

        // Calculate luminance
        const luminance = luminanceCoefficients.r * rLinear + luminanceCoefficients.g * gLinear + luminanceCoefficients.b * bLinear;

        // Calculate contrast ratio against black (which has a luminance of 0)
        const contrastRatio = (luminance + 0.05) / 0.05;

        // Check if the color meets the contrast ratio criterion
        if (contrastRatio >= minContrastRatio) {
            return `#${[red, green, blue].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        }
    }
};

const generateSessionId = () => {
    return crypto.createHash('sha256').update(Date.now().toString()).digest('hex');
};

const sessionId = generateSessionId(); // Generate session ID once
const color = randomBrightColor();

// Pre-calculate color RGB values and ANSI codes for performance
const colorRgb = {
    r: parseInt(color.substring(1, 3), 16),
    g: parseInt(color.substring(3, 5), 16),
    b: parseInt(color.substring(5, 7), 16)
};
const colorAnsiCode = `\x1b[38;2;${colorRgb.r};${colorRgb.g};${colorRgb.b}m`;

// Custom console formatter with random color for session ID and set color for log level and message
const consoleFormatter = (config) => winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const shortSessionId = sessionId.substring(sessionId.length - 6); // Get the last 6 characters of the session ID
        const paddedLevel = level.padEnd(8); // Pad the level to ensure consistent spacing

        // Retrieve the corresponding ANSI color code for the level from custom settings
        const levelColor = customSettings.colors[level] || ''; // Default to no color if the level is unknown
        const resetCode = '\x1b[0m';

        // Build location string (optionally include filePath if reportPath is enabled)
        let locationStr = meta.location || 'Unknown';
        if (config.reportPath && meta.filePath) {
            locationStr += ` ${meta.filePath}`;
        }

        // Apply the color to the padded level and the session ID
        // Note: The session ID color remains based on the 'color' variable (pre-calculated)
        return `${timestamp} [${levelColor}${paddedLevel}${resetCode}] [${colorAnsiCode}ID: ${shortSessionId}${resetCode}] [${locationStr}]: ${levelColor}${message}${resetCode}`;
    }),
);

// Formatter for file logging which shows the full session ID
const fileFormatter = (config) => winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const paddedLevel = level.padEnd(8); // Pad the level to ensure consistent spacing

        // Build location string (optionally include filePath if reportPath is enabled)
        let locationStr = meta.location || 'Unknown';
        if (config.reportPath && meta.filePath) {
            locationStr += ` ${meta.filePath}`;
        }

        // Include all metadata in JSON (filePath is already shown in locationStr but kept in JSON for structured data)
        const metaKeys = Object.keys(meta);
        return `${timestamp} [${paddedLevel}] [ID: ${sessionId}] [${locationStr}]: ${message}${
            metaKeys.length ? ' ' + JSON.stringify(meta, null, 2) : ''
        }`;
    }),
);

/**
 * Wraps a logger method to add all advanced features
 * @param {Function} originalMethod - The original logger method (e.g., logger.info)
 * @param {object} options - Options object with sampler, deduplicator, performanceTracker, etc.
 * @returns {Function} - Wrapped method with all features
 */
function wrapLoggerMethod(originalMethod, options = {}) {
    const {
        reportPathEnabled = false,
        sampler = null,
        deduplicator = null,
        performanceTracker = null,
        childContext = null,
        loggerInstance = null,
        level = 'info',
    } = options;

    return function(...args) {
        // Capture stack trace BEFORE setImmediate to get the actual call site
        let capturedCallSite = null;
        let capturedCallerOfCaller = null;
        if (reportPathEnabled) {
            try {
                const originalPrepareStackTrace = Error.prepareStackTrace;
                Error.prepareStackTrace = (_, stack) => stack;

                const err = new Error();
                const stack = err.stack;

                Error.prepareStackTrace = originalPrepareStackTrace;

                // Stack structure: stack[0] = this wrapper function, stack[1] = actual caller
                // Walk up the stack to skip internal Node.js functions
                if (stack && stack.length >= 2) {
                    // Helper to check if a call site is internal
                    const isInternal = (callSite) => {
                        if (!callSite) return true;
                        const funcName = callSite.getFunctionName() || callSite.getMethodName() || '';
                        const fileName = callSite.getFileName() || '';
                        return (funcName.startsWith('_') || 
                                fileName.includes('node:internal/') || 
                                fileName.includes('node_modules/') ||
                                fileName.includes('internal/') ||
                                ['_onTimeout', 'listOnTimeout', 'processTimers', 'setImmediate', 'setTimeout', 'setInterval'].includes(funcName));
                    };

                    // Start from stack[1] (skip our wrapper)
                    let callSiteIndex = 1;
                    
                    // Skip internal functions to find the actual user code
                    while (callSiteIndex < stack.length && isInternal(stack[callSiteIndex])) {
                        callSiteIndex++;
                    }
                    
                    if (callSiteIndex < stack.length) {
                        capturedCallSite = stack[callSiteIndex];
                        
                        // Find the caller of the caller, also skipping internals
                        let callerIndex = callSiteIndex + 1;
                        while (callerIndex < stack.length && isInternal(stack[callerIndex])) {
                            callerIndex++;
                        }
                        
                        if (callerIndex < stack.length) {
                            capturedCallerOfCaller = stack[callerIndex];
                        }
                    } else {
                        // Fallback: use stack[1] if we can't find non-internal
                        capturedCallSite = stack[1];
                        capturedCallerOfCaller = stack.length > 2 ? stack[2] : null;
                    }
                }
            } catch (err) {
                // Silently fail
            }
        }

        // Use setImmediate to make this non-blocking
        setImmediate(() => {
            const startTime = performanceTracker?.enabled ? performance.now() : null;

            try {
                // Extract message and metadata (Winston format: method(message, meta) or method(message))
                let message = args[0];
                let meta = {};
                
                if (args.length > 1 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1])) {
                    // Standard format: method(message, meta)
                    meta = { ...args[args.length - 1] };
                    message = args[0];
                } else if (args.length === 1) {
                    if (typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
                        // Object format: method({ message: '...', ...other })
                        message = args[0].message || JSON.stringify(args[0]);
                        meta = { ...args[0] };
                        delete meta.message;
                    } else {
                        // Just a message string
                        message = args[0];
                    }
                }

                // Merge child context if available
                if (childContext) {
                    meta = { ...childContext, ...meta };
                }

                // Check sampling and rate limiting
                if (sampler && !sampler.shouldProcess(level)) {
                    if (performanceTracker?.enabled && startTime) {
                        performanceTracker.recordLogProcessing(performance.now() - startTime);
                    }
                    return;
                }

                // Use captured stack trace for filePath
                if (reportPathEnabled && capturedCallSite) {
                    const filePath = reportPath(capturedCallSite, capturedCallerOfCaller);
                    if (filePath) {
                        meta.filePath = filePath;
                    }
                }

                // Check deduplication
                if (deduplicator) {
                    const dedupResult = deduplicator.check(level, String(message), meta);
                    if (dedupResult) {
                        if (!dedupResult.shouldLog) {
                            // Suppressed by deduplication
                            if (performanceTracker?.enabled && startTime) {
                                performanceTracker.recordLogProcessing(performance.now() - startTime);
                            }
                            return;
                        }
                        // Update message with count if needed
                        if (dedupResult.count > 1 && dedupResult.message !== String(message)) {
                            message = dedupResult.message;
                        }
                    }
                }

                // Call the original method with modified args (Winston format)
                const transportStartTime = performanceTracker?.enabled ? performance.now() : null;
                const target = loggerInstance || this;
                originalMethod.call(target, message, meta);
                
                if (performanceTracker?.enabled) {
                    const logTime = performance.now() - startTime;
                    performanceTracker.recordLogProcessing(logTime);
                    if (transportStartTime) {
                        performanceTracker.recordTransport(performance.now() - transportStartTime);
                    }
                }
            } catch (err) {
                // Don't break logging if wrapper fails - fall back to original method
                try {
                    originalMethod.apply(this, args);
                } catch (fallbackErr) {
                    // Last resort - log to console
                    console.error('Logger wrapper error:', err);
                    console.error('Fallback also failed:', fallbackErr);
                }
            }
        });
    };
}

const createLoggerInstance = (location = "Unknown", config = {}, transports, parentContext = null) => {
    // Configuration options
    const {
        level = 'info',
        console = true,
        debug = false,
        file = true,
        filename = `${location}.log`,
        path = './logs',
        maxSize = 1048576,
        maxFiles = 5,
        timestamp = true,
        skipCache = false,
        reportPath: reportPathEnabled = false,
        sampling = {},
        rateLimit = {},
        deduplication = { enabled: false, threshold: 3, window: 60000 },
        performanceMetrics = process.env.NODE_ENV === 'development',
        statsInterval = 0,
    } = config;

    let logTransport = [].filter(Boolean);

    if (console) {
        const consoleFormat = consoleFormatter(config);

        logTransport.push(new winston.transports.Console({ format: consoleFormat }),);
    }

    if (file) {
        const fileFormat = fileFormatter(config);

        // If you want really verbose logging, such as, log files per new logging instance with each level, follow this example
        // logTransport.push(
        //     new winston.transports.File({ filename: `${path}/${filename}`, level: 'fatal', format:fileFormat ,maxsize: maxSize, maxFiles: maxFiles }),
        //     new winston.transports.File({ filename: `${path}/${filename}`, level: 'error', format:fileFormat ,maxsize: maxSize, maxFiles: maxFiles }),
        //     new winston.transports.File({ filename: `${path}/${filename}`, format:fileFormat, maxsize: maxSize, maxFiles: maxFiles }),
        // );

        // If you want to logger instance of same level to the same file, follow this example (default)
        logTransport.push(
            new winston.transports.File({ filename: `${path}/fatal.log`, level: 'fatal', format: fileFormat, maxsize: maxSize, maxFiles: maxFiles }),
            new winston.transports.File({ filename: `${path}/error.log`, level: 'error', format: fileFormat, maxsize: maxSize, maxFiles: maxFiles }),
            new winston.transports.File({ filename: `${path}/combined.log`, format: fileFormat, maxsize: maxSize, maxFiles: maxFiles }),
        );
    }
    if (transports) {logTransport = logTransport.concat
(transports);}

    // Create a new logger instance
    const logger = winston.createLogger({
        level: level,
        levels: customSettings.levels,
        transports: logTransport,
        defaultMeta: {
            location,
            ID: sessionId,
            timeCreated: new Date().toLocaleTimeString('en-US', {hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3})
        }
    });

    // Initialize feature modules
    const sampler = (Object.keys(sampling).length > 0 || Object.keys(rateLimit).length > 0) 
        ? new LogSampler({ sampling, rateLimit }) 
        : null;
    const deduplicator = deduplication.enabled 
        ? new LogDeduplicator(deduplication) 
        : null;
    const perfTracker = performanceMetrics 
        ? new PerformanceTracker(true) 
        : null;

    // Store child context (merge with parent if exists)
    const childContext = parentContext ? Object.freeze({ ...parentContext }) : null;

    // Wrap logger methods with all features
    const wrapOptions = {
        reportPathEnabled,
        sampler,
        deduplicator,
        performanceTracker: perfTracker,
        childContext,
        loggerInstance: logger,
    };

    const boundLogger = logger;
    logger.info = wrapLoggerMethod(boundLogger.info.bind(boundLogger), { ...wrapOptions, level: 'info' });
    logger.warn = wrapLoggerMethod(boundLogger.warn.bind(boundLogger), { ...wrapOptions, level: 'warn' });
    logger.error = wrapLoggerMethod(boundLogger.error.bind(boundLogger), { ...wrapOptions, level: 'error' });
    logger.debug = wrapLoggerMethod(boundLogger.debug.bind(boundLogger), { ...wrapOptions, level: 'debug' });
    logger.trace = wrapLoggerMethod(boundLogger.trace.bind(boundLogger), { ...wrapOptions, level: 'trace' });
    logger.fatal = wrapLoggerMethod(boundLogger.fatal.bind(boundLogger), { ...wrapOptions, level: 'fatal' });
    logger.internal = wrapLoggerMethod(boundLogger.internal.bind(boundLogger), { ...wrapOptions, level: 'internal' });

    // Add child logger method
    logger.child = function(context) {
        const mergedContext = childContext ? { ...childContext, ...context } : context;
        // Use skipCache for child loggers to avoid cache conflicts
        const childConfig = { ...config, skipCache: true };
        // Generate unique location for child logger
        const childLocation = `${location}:child:${Date.now()}:${Math.random().toString(36).substring(7)}`;
        return createLoggerInstance(childLocation, childConfig, transports, mergedContext);
    };

    // Add performance tracking methods
    if (perfTracker) {
        logger.time = function(label) {
            perfTracker.time(label);
        };
        logger.timeEnd = function(label) {
            const duration = perfTracker.timeEnd(label);
            if (duration !== null) {
                logger.debug(`Timer '${label}' completed in ${duration.toFixed(2)}ms`);
            }
            return duration;
        };
    }

    // Add statistics method
    logger.getStats = function() {
        const stats = {
            sampling: sampler ? sampler.getStats() : null,
            deduplication: deduplicator ? deduplicator.getStats() : null,
            performance: perfTracker ? perfTracker.getStats() : null,
        };
        return stats;
    };

    // Add flush method (non-blocking, returns Promise)
    logger.flush = function() {
        return new Promise((resolve) => {
            setImmediate(() => {
                // Flush all transports that support it
                const flushPromises = logger.transports.map(transport => {
                    if (transport.flush && typeof transport.flush === 'function') {
                        return Promise.resolve(transport.flush());
                    }
                    return Promise.resolve();
                });
                Promise.all(flushPromises).then(() => resolve());
            });
        });
    };

    // Add close method (graceful shutdown)
    logger.close = function() {
        return new Promise((resolve) => {
            setImmediate(() => {
                // Destroy feature modules
                if (sampler) sampler.destroy();
                if (deduplicator) deduplicator.destroy();
                
                // Close all transports
                logger.end(() => {
                    resolve();
                });
            });
        });
    };

    // Statistics reporting interval
    if (statsInterval > 0 && (sampler || deduplicator)) {
        setInterval(() => {
            const stats = logger.getStats();
            logger.internal('Logger Statistics:', stats);
        }, statsInterval);
    }

    // Cache the newly created logger instance
    loggerInstances.set(location, logger);

    if (debug === true) {
        // Use pre-calculated color values
        const resetCode = `\x1b[0m`;

        logger.internal(`Logger instance created from ${location} with session ID: ${colorAnsiCode}${sessionId.slice(-6)}${resetCode}`);
        logger.internal(`Logger instance created from ${location} with color: ${colorAnsiCode}${color}${resetCode}`);
        logger.internal(`Logger instance created from ${location} with log level: ${colorAnsiCode}${logger.level}${resetCode}`);
    }

    return logger;
}

/***
    * Logger function
    *
    * @param {string} location - The location of the logger instance
    * @param {object} config - Configuration options for the logger instance
    * @returns {object} - The logger instance
    */
const logger = (location = "Unknown", config = {}) => {
    // Check if a logger for the given location already exists
    if (loggerInstances.has(location) && !config.skipCache) {
        // If it does, grab the existing logger instance from the map
        const logger = loggerInstances.get(location);

        logger.internal(`Logger instance retrieved for location ${location}`); // Log the retrieval of the logger instance
        return logger;
    }

    let transports = null;
    // Initialize plugins if they are provided in the configuration
    if (config.plugins) {
        transports = initPlugins(config.plugins)
    }

    // If not, create a new logger instance for the location
    return createLoggerInstance(location, config, transports);
};

// Export a function to create or return the existing logger instance
module.exports = logger;