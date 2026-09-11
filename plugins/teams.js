/**
 * @file /plugins/teams.js
 * @description Sends logs to a Teams webhook.
 */

const Transport = require('winston-transport');
const { HttpDelivery } = require('./lib/httpDelivery');

const levels = require('../lib/levels');

class TeamsTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'Teams Webhook Transport for NTLogger';

        this.webhookUrl = opts.webhookUrl;
        this.delivery = new HttpDelivery(opts.webhookUrl, opts);
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
            const payload = this.createPayload(level, message, meta);
            if (this.closed) throw new Error('HTTP transport is closed');
            await this.delivery.send(payload);
            this.emit('logged', info);
            callback();
        } catch (error) { callback(error); }

    }

    createPayload(level, message, meta) {
        const actions = [];
        const body = [
            {
                type: 'TextBlock',
                text: `Log Level: ${level.toUpperCase()} - ${message}`,
                weight: 'Bolder',
                size: 'Medium'
            }
        ];
        const mentions = [];
        let mentionTextAdded = false;  // Track if the mention text block has been added

        // Ensure meta is treated as an array
        const metaArray = Array.isArray(meta) ? meta : Object.values(meta);

        metaArray.forEach(item => {
            if (!item || typeof item !== 'object' || !item.type) {
                return;
            }

            switch (item.type) {
                case 'raw':
                    if (item.raw && Array.isArray(item.raw.body)) {
                        body.push(...item.raw.body);
                    }
                    if (item.raw && Array.isArray(item.raw.action)) {
                        actions.push(...item.raw.action);
                    }
                    break;

                case 'location':
                    body.push({
                        type: 'FactSet',
                        facts: [
                            { title: "District", value: item.district || "N/A" },
                            { title: "Store", value: item.store || "N/A" },
                            { title: "Department", value: item.department || "N/A" }
                        ]
                    });
                    break;

                case 'button':
                    actions.push({
                        type: 'Action.OpenUrl',
                        title: item.actionableBoxName || "Button",
                        url: item.actionableURL || '#'
                    });
                    break;

                case 'ping':
                    if (!mentionTextAdded) {
                        body.push({
                            type: 'Container',
                            items: [
                                {
                                    type: 'TextBlock',
                                    text: `<at>${item.mentionId}</at>`,
                                    wrap: true
                                }
                            ]
                        });
                        mentionTextAdded = true;
                    }
                    mentions.push({
                        type: 'mention',
                        text: `<at>${item.mentionId}</at>`,
                        mentioned: {
                            id: item.mentionId
                        }
                    });
                    break;

                case 'error':
                    body.push({
                        type: 'TextBlock',
                        text: `Error: ${item.message || "No message"}`,
                        weight: 'Bolder',
                        color: 'Attention',
                        wrap: true
                    });
                    if (item.stack) {
                        body.push({
                            type: 'TextBlock',
                            text: `Stack Trace: ${item.stack}`,
                            color: 'Attention',
                            wrap: true
                        });
                    }
                    break;

                case 'metric':
                    body.push({
                        type: 'FactSet',
                        facts: [
                            { title: item.name || "Metric", value: item.value || "N/A" }
                        ]
                    });
                    break;

                case 'ColumnSet':
                    if (item.complexity === 'complex') {
                        const columns = item.table[0].map((header, colIndex) => ({
                            type: 'Column',
                            items: [
                                {
                                    type: 'TextBlock',
                                    text: header.text || header,
                                    weight: 'Bolder',
                                    separator: true,
                                    wrap: true
                                },
                                ...item.table.slice(1).map(row => {
                                    return row[colIndex]
                                })
                            ],
                            width: 'auto'
                        }));

                        const columnSet = {
                            type: 'ColumnSet',
                            separator: true,
                            columns: columns
                        };

                        body.push(columnSet);
                        break;
                    } else {
                        const columns = item.table[0].map((header, colIndex) => ({
                            type: 'Column',
                            items: [
                                {
                                    type: 'TextBlock',
                                    text: header,
                                    weight: 'Bolder',
                                    separator: true,
                                    wrap: true
                                },
                                ...item.table.slice(1).map(row => ({
                                    type: 'TextBlock',
                                    text: row[colIndex],
                                    separator: true,
                                    wrap: true
                                }))
                            ],
                            width: 'auto'
                        }));

                        const columnSet = {
                            type: 'ColumnSet',
                            separator: true,
                            columns: columns
                        };

                        body.push(columnSet);
                        break;
                    }
                    break;

                default:
                    body.push({
                        type: 'TextBlock',
                        text: `Unsupported type: ${item.type}`,
                        color: 'Warning',
                        wrap: true
                    });
                    break;
            }
        });

        return JSON.stringify({
            type: 'message',
            attachments: [
                {
                    summary: `Log Level: ${level.toUpperCase()} - ${message}`,
                    contentType: 'application/vnd.microsoft.card.adaptive',
                    content: {
                        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                        version: '1.2',
                        msteams: {
                            entities: mentions
                        },
                        body: body,
                        actions: actions
                    }
                }
            ]
        });
    }
    flush() { return this.delivery.flush(); }
    close() {
        this.closed = true;
        return this.delivery.flush();
    }

}

module.exports = {
    transport: TeamsTransport,
};
