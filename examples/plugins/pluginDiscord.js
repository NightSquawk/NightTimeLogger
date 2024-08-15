// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

// Configure the Logger
let config = {
    level: process.env.LOG_LEVEL,
    file: false,
    plugins: [
        {
            name: 'Discord',
            config: {
                webhookUrl: process.env.DISCORD_WEBHOOK_URL || 'https://ptb.discord.com/api/webhooks/1271901134661782658/FmzqFlzbIJ7NunR_4rpBkPLb4QQ5aHSGke3pT311su-QM3ZlGD6sFuC4FfMF_TFf3k',
                avatarUrl: process.env.DISCORD_AVATAR_URL || 'https://pbs.twimg.com/profile_images/997535493624508416/V7Ed1k2o_400x400.jpg',
                username: process.env.DISCORD_USERNAME || 'NTLogger - Info',
                level: "info",
                strict: true,
            },
        },
        {
            name: 'Discord',
            config: {
                webhookUrl: process.env.DISCORD_WEBHOOK_URL || 'https://ptb.discord.com/api/webhooks/1271901134661782658/FmzqFlzbIJ7NunR_4rpBkPLb4QQ5aHSGke3pT311su-QM3ZlGD6sFuC4FfMF_TFf3k',
                avatarUrl: process.env.DISCORD_AVATAR_URL || 'https://pbs.twimg.com/profile_images/997535493624508416/V7Ed1k2o_400x400.jpg',
                username: process.env.DISCORD_USERNAME || 'NTLogger - Warn and Above',
                level: "warn",
                strict: false,
            },
        },
    ],
}

// Create a logger instance
const log = logger('Plugin Example - Discord', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
