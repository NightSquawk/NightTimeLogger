# NightTimeLogger Plugins

NightTimeLogger is a powerful and flexible logging utility with various plugins to extend its functionality. This README provides an overview of the available plugins and instructions on how to set them up.

![Discord Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/pluginDiscordOutput.png)

## Available Plugins

### 1. Discord
**Description:** Sends logs to a Discord webhook, allowing you to receive log messages directly in a specified Discord channel.

**Setup:**
```javascript
{
    name: 'Discord',
    config: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL || 'https://ptb.discord.com/api/webhooks/1271901134663192658/FmzqFlzbIJ7NunR_4rpBkPLb4QQ5aHSNEbpT311su-QM3ZlGDI6sFuC4Ff0MF_TFrf3k',
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

### . MySQL
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

### Example Logger Configuration
Here is an example configuration for NightTimeLogger using multiple plugins:

``` javascript
Copy code
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