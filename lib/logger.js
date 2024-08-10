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

// Custom console formatter with random color for session ID and set color for log level and message
const consoleFormatter = (config) => winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const shortSessionId = sessionId.substring(sessionId.length - 6); // Get the last 6 characters of the session ID
        const paddedLevel = level.padEnd(8); // Pad the level to ensure consistent spacing

        // Retrieve the corresponding ANSI color code for the level from custom settings
        const levelColor = customSettings.colors[level] || ''; // Default to no color if the level is unknown
        const resetCode = '\x1b[0m';

        // Apply the color to the padded level and the session ID
        // Note: The session ID color remains based on the 'color' variable
        return `${timestamp} [${levelColor}${paddedLevel}${resetCode}] [\x1b[38;2;${parseInt(color.substring(1, 3), 16)};${parseInt(color.substring(3, 5), 16)};${parseInt(color.substring(5, 7), 16)}mID: ${shortSessionId}${resetCode}] [${meta.location || 'Unknown'}]: ${levelColor}${message}${resetCode}`;
    }),
);

// Formatter for file logging which shows the full session ID
const fileFormatter = (config) => winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const paddedLevel = level.padEnd(8); // Pad the level to ensure consistent spacing

        return `${timestamp} [${paddedLevel}] [ID: ${sessionId}] [${meta.location || 'Unknown'}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        }`;
    }),
);

const createLoggerInstance = (location = "Unknown", config = {}, transports) => {
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

    // Cache the newly created logger instance
    loggerInstances.set(location, logger);

    if (debug === true) {
        // Extract RGB components from the color string
        const rgb = {
            r: parseInt(color.slice(1, 3), 16),
            g: parseInt(color.slice(3, 5), 16),
            b: parseInt(color.slice(5, 7), 16)
        };

        // Construct ANSI escape code for the RGB color
        const colorCode = `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
        const resetCode = `\x1b[0m`;

        logger.internal(`Logger instance created from ${location} with session ID: ${colorCode}${sessionId.slice(-6)}${resetCode}`);
        logger.internal(`Logger instance created from ${location} with color: ${colorCode}${color}${resetCode}`);
        logger.internal(`Logger instance created from ${location} with log level: ${colorCode}${logger.level}${resetCode}`);
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