// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

// Configure the Logger
let config = {
    level: process.env.LOG_LEVEL || 'trace',
    file: false,
    plugins: [
        {
            name: 'Teams',
            config: {
                webhookUrl: process.env.TEAMS_WEBHOOK_URL || "im not leaking my webhook url again",
                level: process.env.LOG_LEVEL || "info",
                strict: process.env.LOG_STRICT_LOGGING || true,
            },
        },
        {
            name: 'Teams',
            config: {
                webhookUrl: process.env.TEAMS_WEBHOOK_URL || "im not leaking my webhook url again",
                level: "warn",
                strict: false,
            },
        },
    ],
}

// Create a logger instance
const log = logger('Plugin Example - Teams', config);

/**
 * The Teams plugin is a plugin that sends logs to a Microsoft Teams channel.
 *
 * It supports two types of configurations:
 * 1. Predefined types that are configured to work plug-and-play with the logger. (Simple usage)
 *    All defined types are listed in the example below.
 *    You can find an example of the predefined type in the info log message.
 *
 * 2. A custom raw type that allows you to send any type of message. (Advanced usage)
 *    The raw type allows you to build your own request body. Just make sure to follow the https://adaptivecards.io/explorer/AdaptiveCard.html schema.
 *    You can find an example of a raw type in the error log message.
 *
 * It's useful to note that you can also combine multiple types in a single log message.
 * This is demonstrated in the warn log message.
 *
 * Also for some objects, you can specify the complexity parameter to either simple or complex.
 *    The following objects support the complexity parameter:
 *        - ColumnSet
 */

// Log messages at different levels
log.info('Informational message',   [
    { type: "location", district: "District 1", store: "Store 1", department: "Department 1"},
    { type: "button", actionableBoxName: "First Button!", actionableURL: 'firstURL' },
    { type: "button", actionableBoxName: "Second Button!", actionableURL: 'secondURL' },
    // { type: "ping", mentionId: "example@example.com"}, // MUST BE A VALID USER EMAIL
    // { type: "ping", mentionId: "example@example.com"}, // MUST BE A VALID USER EMAIL
    { "type": "error", "message": "An unexpected error occurred.", "stack": "Error stack trace here" },
    { "type": "metric", "name": "CPU Usage", "value": "85%" },
    { "type": "metric", "name": "Request Count", "value": 123 },
]);

log.warn('Warning message',   [
    { type: "raw", raw: {body:[{ type: "TextBlock", text: "ColumnSet - Simple" }]}},
    {
        type: "ColumnSet",
        complexity: "simple",
        table: [
            ["Header 1", "Header 2", "Header 3"],
            ["Row 1 Col 1", "Row 1 Col 2", "Row 1 Col 3"],
            ["Row 2 Col 1", "Row 2 Col 2", "Row 2 Col 3"],
            ["Row 3 Col 1", "Row 3 Col 2", "Row 3 Col 3"]
        ]
    },
    { type: "raw", raw: {body:[{ type: "TextBlock", text: "ColumnSet - Complex" }]}},
    {
        type: "ColumnSet",
        complexity: "complex",
        table: [
            [{ type: "TextBlock", text: "Cats" },{ type: "TextBlock", text: "Dogs" }, { type: "TextBlock", text: "Birds" }],
                [
                    { type: "Image",url: "https://png.pngtree.com/png-clipart/20230511/ourmid/pngtree-isolated-cat-on-white-background-png-image_7094927.png", altText: "Cat", wrap: true, size: "auto", separator: true, },
                    { type: "Image",url: "https://i.pinimg.com/originals/07/b2/40/07b240561cb656aec289df602e603bee.png", altText: "Dog", wrap: true, size: "auto", separator: true, },
                    { type: "Image",url: "https://cdn.pixabay.com/photo/2016/03/02/13/59/bird-1232416_1280.png", altText: "Bird", wrap: true, size: "auto", separator: true, }
                ],

        ]
    }
]);

log.error('Error message',[
    { type: "raw", raw: {
    body: [
        { type: "TextBlock", text: "Raw Type" },
        {
            type: "ColumnSet",
            columns: [
                { type: "Column",
                    items: [
                        { "type": "TextBlock", "text": "Cats" },
                        { type: "Image",url: "https://png.pngtree.com/png-clipart/20230511/ourmid/pngtree-isolated-cat-on-white-background-png-image_7094927.png", altText: "Cat", wrap: true, size: "auto", separator: true, },
                    ]
                },
                { type: "Column",
                    items: [
                        { "type": "TextBlock", "text": "Dogs" },
                        { type: "Image",url: "https://i.pinimg.com/originals/07/b2/40/07b240561cb656aec289df602e603bee.png", altText: "Dog", wrap: true, size: "auto", separator: true, },
                    ]
                },
                { type: "Column",
                    items: [
                        { "type": "TextBlock", "text": "Birds" },
                        { type: "Image",url: "https://cdn.pixabay.com/photo/2016/03/02/13/59/bird-1232416_1280.png", altText: "Bird", wrap: true, size: "auto", separator: true, }
                    ]
                },
            ]
        },
        {
            "type": "FactSet",
            "facts": [
                {
                    "title": "Fact 1",
                    "value": "Value 1"
                },
                {
                    "title": "Fact 2",
                    "value": "Value 2"
                },
                {
                    "title": "Fact 3",
                    "value": "Value 3"
                },
                {
                    "title": "Fact 4",
                    "value": "Value 5"
                }
            ]
        },
    ],
    action: [
        {
            type: 'Action.OpenUrl',
            title: "See more cats!",
            url: 'https://www.google.com/search?q=cute%20cats&udm=2'
        },
        {
            type: 'Action.OpenUrl',
            title: "Chickens?",
            url: 'https://www.google.com/search?q=chickens&udm=2'
        },
        {
            "type": "Action.ShowCard",
            "title": "Whats this?",
            "card": {
                "type": "AdaptiveCard",
                "body": [
                    {
                        "type": "TextBlock",
                        "text": "Cool?"
                    }
                ],
                "actions": [
                    {
                        "type": "Action.Submit",
                        "title": "You betcha!",
                        "data": {
                            "betcha": "true"
                        }
                    }
                ]
            }
        }
        ]},
    },
]);

log.debug('Debugging message',);
log.trace('Trace message',);

// Log internal messages
log.internal('Internal message');
