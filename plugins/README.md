# NightTimeLogger Plugins

NightTimeLogger is a powerful and flexible logging utility with various plugins to extend its functionality. This README provides an overview of the available plugins and instructions on how to set them up.

## Available Plugins

### 1. Discord
**Description:** Sends logs to a Discord webhook, allowing you to receive log messages directly in a specified Discord channel.

![Discord Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/discord/pluginDiscordOutput.png)

**Setup:**
```javascript
{
    name: 'Discord',
    config: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL
        avatarUrl: process.env.DISCORD_AVATAR_URL || 'https://pbs.twimg.com/profile_images/997535493624508416/V7Ed1k2o_400x400.jpg',
        username: process.env.DISCORD_USERNAME || 'NTLogger - Info',
        level: "info",
        strict: true,
    },
}
```

### 2. Sentry
Description: Initializes the Sentry SDK for error tracking and defines a custom Winston transport for capturing and sending error logs to Sentry.

Setup:

``` javascript
{
    name: 'Sentry',
    config: {
        dsn: process.env.SENTRY_DSN || null,
        release: process.env.SENTRY_RELEASE || null,
        tracesSampleRate: 1.0,
        profilesSampleRate: 1.0,
        environment: process.env.NODE_ENV || 'development',
        debug: false,
        attachStacktrace: true,
        integrations: [
            nodeProfilingIntegration()
        ],
        serverName: null,
        maxBreadcrumbs: 100,
        autoSessionTracking: true,
        sessionTracking: {},
        tracesSampler: null
    }
}
```

### 3. MySQL
Description: Stores logs in a MySQL database, allowing you to persist log messages and analyze them using SQL queries.

Setup:

``` javascript
{
    name: 'MySQL',
    config: {
        host: process.env.MYSQL_DB_HOST || 'localhost',
        port: process.env.MYSQL_DB_PORT || 3306,
        user: process.env.MYSQL_DB_USER || 'root',
        password: process.env.MYSQL_DB_PASSWORD || '',
        database: process.env.MYSQL_DB_NAME || 'test',
        table: process.env.MYSQL_DB_TABLE || 'logs',
        logLevel: process.env.LOG_LEVEL || 'info',
    },
}
````
### 4. Jest
Description: Stores log messages in memory for testing purposes, particularly useful when running tests with Jest.

Setup:

``` javascript
{
    name: 'Jest',
}
```

### 5. Syslog
Description: Sends logs to a Syslog server using a custom Syslog client. This allows integration with traditional logging systems that rely on Syslog.

![Syslog Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/syslog/pluginSyslogOutput.png)


Setup:

``` javascript
{
    name: 'Syslog',
    config: {
        host: process.env.SYSLOG_HOST || 'localhost',
        port: process.env.SYSLOG_PORT || 514,
        protocol: process.env.SYSLOG_PROTOCOL || 'UDP', // Options: 'UDP', 'TCP', 'TLS'
        rfc: process.env.SYSLOG_RFC || 'RFC-5424', // Options: 'RFC-3164', 'RFC-5424'
        facility: process.env.SYSLOG_FACILITY || 1, // Local0
        appName: process.env.SYSLOG_APP_NAME || 'MyApp',
        level: 'info',
    },
}
```

### 6. Teams
**Description:** Sends logs to a Microsoft Teams channel using an incoming webhook connector. This plugin allows you to receive log messages directly in a specified Teams channel.


![Teams Mixed Object Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/teams/pluginTeamsMixedOutput.png)


**Setup:**

``` javascript
{
    name: 'Teams',
        config: {
        webhookUrl: process.env.TEAMS_WEBHOOK_URL || "im not leaking my webhook url again",
            level: process.env.LOG_LEVEL || "info",
            strict: process.env.LOG_STRICT_LOGGING || true,
    },
},
```

This plugin supports additional configuration at the meta level. This allows you to create complex Teams messages with custom formatting and attachments..

![Teams Simple Object Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/teams/pluginTeamsSimpleOutput.png)

```javascript
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
```

It also supports the complete https://adaptivecards.io/explorer/AdaptiveCard.html schema.

![Teams Raw Object Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/teams/pluginTeamsRawOutput.png)

```javascript
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
```

### Example Logger Configuration
Here is an example configuration for NightTimeLogger using multiple plugins:

``` javascript

let config = {
    level: 'internal',
    file: false,
    plugins: [
        {
            name: 'Discord',
            config: {
                webhookUrl: process.env.DISCORD_WEBHOOK_URL,
                avatarUrl: process.env.DISCORD_AVATAR_URL,
                username: process.env.DISCORD_USERNAME || 'MyAppLogger',
                level: 'info',
                strict: false,
            },
        },
        {
            name: 'Sentry',
            config: {
                dsn: process.env.SENTRY_DSN,
                release: process.env.SENTRY_RELEASE,
                tracesSampleRate: 1.0,
                environment: process.env.NODE_ENV || 'development',
            },
        },
        {
            name: 'MySQL',
            config: {
                host: process.env.MYSQL_DB_HOST,
                port: process.env.MYSQL_DB_PORT || 3306,
                user: process.env.MYSQL_DB_USER || 'root',
                password: process.env.MYSQL_DB_PASSWORD || '',
                database: process.env.MYSQL_DB_NAME || 'logs',
                table: 'log_entries',
            },
        },
        {
            name: 'Jest',
        },
        {
            name: 'Syslog',
            config: {
                host: process.env.SYSLOG_HOST || 'localhost',
                port: process.env.SYSLOG_PORT || 514,
                protocol: 'UDP',
                facility: 1,
                appName: 'MyAppLogger',
            },
        },
    ],
};
```

### Conclusion
The NightTimeLogger is highly customizable and supports various plugins for different logging requirements. By leveraging these plugins, you can easily integrate logging into your existing infrastructure, whether it be storing logs in databases, sending them to monitoring tools like Sentry, or receiving alerts directly in Discord.

For more details on each plugin, refer to the specific plugin files in the project.