/**
 * @file /lib/colors.js
 * @description Provides color codes for console output and Discord embeds.
 */

module.exports = {
    console: {
        internal: '\x1b[93m', // Bright yellow
        trace: '\x1b[90m',    // Light gray
        debug: '\x1b[37m',    // White
        info: '\x1b[32m',     // Green
        warn: '\x1b[33m',     // Yellow
        error: '\x1b[31m',    // Red
        fatal: '\x1b[35m',    // Magenta
    },
    discord: {
        internal: 0x95a5a6, // Gray
        trace: 0x607d8b,    // Blue-gray
        debug: 0x3498db,    // Blue
        info: 0x2ecc71,     // Green
        warn: 0xf39c12,     // Orange
        error: 0xe74c3c,    // Red
        fatal: 0x8e44ad,    // Purple
    },
};
