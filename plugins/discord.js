/**
 * @file /plugins/discord.js
 * @description Sends logs to a Discord webhook.
 */

const Transport = require('winston-transport');
const https = require('https');
const { URL } = require('url');

const colors = require('../lib/colors');
const levels = require('../lib/levels'); // Assuming this file contains the log levels mapping

class DiscordTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'Discord Webhook Transport for NTLogger';

        this.webhookUrl = opts.webhookUrl;
        this.username = opts.username || 'NTLogger';
        this.avatarUrl = opts.avatarUrl || null;
        this.strict = opts.strict || false;

        try {
            // Set the log level
            this.level = opts.level || 'info';
            if (!(this.level in levels)) {
                throw new Error(`Invalid log level: ${this.level}`);
            }
            this.levelPriority = levels[this.level]; // Get the numerical priority of the log level
        } catch (error) {
            console.error(`Error setting log level: ${error.message}`);
            console.error(error.stack);
            throw error; // Rethrow the error to stop the transport creation if level is invalid
        }

        this.levelColors = colors.discord;
    }

    async log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        const { level, message, ...meta } = info;

        // Check if the log level matches the configured level (strict mode) or is at or below the configured level
        if (this.strict) {
            if (level !== this.level) {
                callback(); // Skip sending the log if it's not exactly the configured level
                return;
            }
        } else {
            if (levels[level] > this.levelPriority) {
                callback(); // Skip sending the log if it's above the configured level
                return;
            }
        }

        const payload = JSON.stringify({
            username: this.username,
            avatar_url: this.avatarUrl,
            embeds: [
                {
                    title: `Log Level: ${level.toUpperCase()}`,
                    description: message,
                    color: this.levelColors[level] || 0x000000, // Default to black if the level is unknown
                    fields: Object.keys(meta).map(key => ({
                        name: key,
                        value: typeof meta[key] === 'string' ? meta[key] : JSON.stringify(meta[key], null, 2),
                        inline: false,
                    })),
                    timestamp: new Date().toISOString(),
                }
            ]
        });

        const webhookUrl = new URL(this.webhookUrl);

        const options = {
            hostname: webhookUrl.hostname,
            path: webhookUrl.pathname + webhookUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        const req = https.request(options, (res) => {
            res.on('data', (chunk) => {
                console.log(`Response from Discord: ${chunk}`);
            });
            res.on('end', () => {
                callback();
            });
        });

        req.on('error', (e) => {
            console.error(`Failed to send log to Discord: ${e.message}`);
        });

        req.write(payload);
        req.end();
    }
}

module.exports = {
    transport: DiscordTransport,
};
