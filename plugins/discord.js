/**
 * @file /plugins/discord.js
 * @description Sends logs to a Discord webhook.
 */

const Transport = require('winston-transport');
const { HttpDelivery } = require('./lib/httpDelivery');

const colors = require('../lib/colors');
const levels = require('../lib/levels');

class DiscordTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'Discord Webhook Transport for NTLogger';

        this.webhookUrl = opts.webhookUrl;
        this.delivery = new HttpDelivery(opts.webhookUrl, opts);
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

        try {
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

            if (this.closed) throw new Error('HTTP transport is closed');
            await this.delivery.send(payload);
            this.emit('logged', info);
            callback();
        } catch (error) { callback(error); }

    }
    flush() { return this.delivery.flush(); }
    close() {
        this.closed = true;
        return this.delivery.flush();
    }

}

module.exports = {
    transport: DiscordTransport,
};
