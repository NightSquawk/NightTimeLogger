/*!
 * ntlogger
 * Copyright(c) 2024 KR
 * GPL-3.0 Licensed
 */

/**
 * TODO: [Feature] Generic Webhook Plugin for sending logs to any webhook
 * TODO: [Feature] Email Plugin for sending logs to an email address
 * TODO: [Feature] SMS Mail ID Plugin for sending logs to a phone number
 */

/**
 * Change Log:
 * 
 * v2.5.2 - 08/11/2024:
 * [BUG] Fixed an issue where the /plugins/lib folder was not being pushed to npmjs.com.
 *
 * v2.5.1 - 08/10/2024:
 * [BUG] Fixed a bug where Jest plugin was not working due to a missing config parameter. This rule was not originally enforced until v2.5.0.
 *
 * v2.5.0 - 08/10/2024:
 * [NOTE] Syslog plugin can send logs using TLS but it is not tested. Avoid sensitive data.
 * [FEATURE] Added a plugin for Discord webhook integration, allowing log messages to be sent directly to a specified Discord channel.
 * [FEATURE] Added a plugin for Syslog server integration, enabling log messages to be sent to a Syslog server using UDP, TCP, or TLS protocols.
 * [FEATURE] Implemented clean signal handling for graceful shutdowns (SIGINT, SIGTERM).
 *
 * [UPDATED] @sentry/node            ^8.17.0 --> ^8.25.0
 * [UPDATED] mysql2                  ^3.10.2 --> ^3.11.0
 * [UPDATED] winston                 ^3.13.1 --> ^3.14.1
 * [UPDATED] @sentry/profiling-node  ^8.17.0 --> ^8.25.0
 * [UPDATED] jest                    ^29.0.0 --> ^29.7.0
 *
 * v2.4.0 - 08/01/2024:
 * [NOTE] Damn its been 4 months.. kinda. forgot to log last changes
 * [CRITICAL] Fixed `includes` in package.json which prevented plugins folder from being pushed to npmjs.com
 * [QA] Added test cases using jest
 * [FEATURE] Added session ID to logger meta, try `console.log(log.defaultMeta.ID)`
 * [FEATURE] Created the plugin jest. Added a custom transport for in memory logging and testing
 * [FEATURE] Created the config var `skipCache` to allow you to create a new logger instance within the same file. (Usual behavior is to return the same instance within the same file)
 *
 * v2.2.3 - 04/01/2024:
 * Reduced GitHub Actions to only NPM publish
 * Fixed export
 * Modified readme and examples
 *
 * v2.2.2 - 03/31/2024:
 * Take 2 on setting up CI with GitHub Actions to NPM
 * Housekeeping
 *
 * v2.2.1 - 03/31/2024:
 * Tried and failed to setup CI with GitHub Actions to NPM
 *
 * v2.2.0 - 03/31/2024:
 * Renamed project to NightTimeLogger, no longer a daytime logger (old name was Nightly-Logger)
 * Published the project on NPM
 * Added a location parameter to the logger function
 * Modified the logger instance creation to include the location in the metadata
 * Added a map to store logger instances by location instead of one global instance
 * This allows the location to be included in the metadata of each log statement
 * Added a custom 'internal' log level to log internal messages
 * Shortened the output by removing Session from Session ID to increase line availability for messages
 * Increased log level padding to 8 characters to ensure consistent spacing
 * (this looks a bit weird, not sure if I like it but I also tried centered log levels and it no look good :( )
 * Added many configuration options to the logger function (level, internal, console, file, filename, path, maxSize, maxFiles, timestamp)
 *
 * TODO: locations has a weird bug that carries location from instance to instance, ONLY, when another instanced is called
*          from a different file. I have no idea why this is happening.
 *         i.e. app.js calls route.js then back to app.js but the location is still route.js. This does not happen when directly
 *         calling route.js.
 * TODO: probably rewrite the whole thing to improve readability and maintainability
 * TODO: cry
 * TODO: timestamp, filename have not been tested nor implemented
 *
 * v2.1.0 - 03/17/2024:
 * Modified custom log colors to use ANSI escape codes
 * Changed the console formatter to paint the level and message with the corresponding color
 * Modified the color generation formula. Now with prettier colors!
 *
 * v2.0.0 - 01/20/2024:
 * Added bright color generation
 * Added session ID generation
 * Added separate console and file formatters
 * Added rotating file transport with 5 files of 1MB each (5MB total)
 *
 * v1.0.0 - 10/18/2023:
 * Initial release
 */

module.exports = require('./lib/logger');