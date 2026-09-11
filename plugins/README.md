# NightTimeLogger Plugins

NightTimeLogger is a powerful and flexible logging utility with various plugins to extend its functionality. This README provides an overview of the available plugins and instructions on how to set them up.

## Required Plugin Entry Fields

Every entry in the `plugins` array **must** supply all three of the following. The
loader silently skips a plugin whose `enabled` is missing/falsy, and reports and skips
a plugin whose `config` is missing or is not an object:

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Must be one of `Sentry`, `MySQL`, `Postgres`, `Jest`, `Syslog`, `Discord`, `Teams`, `OpenObserve`, `OpenTelemetry`. Unknown names are reported and skipped. |
| `enabled` | yes | Must be `true`. A plugin with `enabled: false` (or omitted) is skipped. |
| `config` | yes | Must be an object, even if empty (`config: {}`). |

## Optional Peer Dependencies

The heavier plugin backends are **optional peer dependencies**: installing `ntlogger`
does not pull them in, so projects that do not use those plugins stay lean. Install the
peer for each plugin you actually enable:

| Plugin | Install |
| --- | --- |
| Sentry | `npm install @sentry/node` |
| MySQL | `npm install mysql2` |
| Postgres | `npm install pg` |
| OpenTelemetry | `npm install @opentelemetry/api @opentelemetry/api-logs @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions` |
| Discord, Teams, OpenObserve, Syslog, Jest | none - no extra packages required |

If the peer is missing, the plugin loader reports an actionable error naming the
package and the install command, then skips that plugin. Every other plugin in the
same configuration still loads and the logger keeps working.

## Available Plugins

### 1. Discord
**Description:** Sends logs to a Discord webhook, allowing you to receive log messages directly in a specified Discord channel.

![Discord Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/discord/pluginDiscordOutput.png)

**Peer dependency:** none.

**Setup:**
```javascript
{
    name: 'Discord',
    enabled: true,
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

**Peer dependency:** `npm install @sentry/node` (plus `@sentry/profiling-node` if you use
`nodeProfilingIntegration()`).

Setup:

``` javascript
{
    name: 'Sentry',
    enabled: true,
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

**Peer dependency:** `npm install mysql2`.

Setup:

``` javascript
{
    name: 'MySQL',
    enabled: true,
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

**Peer dependency:** none.

Setup (`enabled` and an object `config` are both required, even though the Jest
transport takes no options):

``` javascript
{
    name: 'Jest',
    enabled: true,
    config: {},
}
```

### 5. Syslog
Description: Sends logs to a Syslog server using a custom Syslog client. This allows integration with traditional logging systems that rely on Syslog.

![Syslog Plugin Output](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/plugins/syslog/pluginSyslogOutput.png)


**Peer dependency:** none.

Setup:

``` javascript
{
    name: 'Syslog',
    enabled: true,
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


**Peer dependency:** none.

**Setup:**

``` javascript
{
    name: 'Teams',
    enabled: true,
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

### 7. OpenObserve
**Description:** Sends logs to OpenObserve, an open-source observability platform. This plugin automatically strips ANSI escape codes, removes timestamps, and sends clean structured JSON logs to OpenObserve's HTTP API with batching support for improved performance.

**Peer dependency:** none.

**Setup:**

```javascript
{
    name: 'OpenObserve',
    enabled: true,
    config: {
        host: process.env.OPENOBSERVE_HOST || 'http://localhost:5080',
        organization: process.env.OPENOBSERVE_ORGANIZATION || 'default',
        stream: process.env.OPENOBSERVE_STREAM || 'logs',
        username: process.env.OPENOBSERVE_USERNAME || 'root@example.com',
        password: process.env.OPENOBSERVE_PASSWORD || 'ComplexPass#123',
        batchSize: 100, // Optional: Number of logs to batch before sending (default: 100)
        timeThreshold: 5000, // Optional: Time in milliseconds before sending batch (default: 5000)
        level: 'info', // Optional: Minimum log level to send (default: 'info')
    },
}
```

**Features:**
- Automatic ANSI code stripping from all log messages and metadata
- Timestamp removal (OpenObserve adds its own `_timestamp` field)
- Batching support to reduce HTTP requests and improve performance
- Clean structured JSON output suitable for OpenObserve ingestion
- Support for all log levels with configurable filtering

### 8. OpenTelemetry
**Description:** Sends logs to an OpenTelemetry collector as OTLP log records. Maps ntlogger levels to OTel `SeverityNumber`/`SeverityText`, strips ANSI colour codes, flattens metadata into OTel attributes (nested objects are JSON-stringified), and automatically attaches `trace_id`/`span_id` from the active span when `@opentelemetry/api` is installed.

**Peer dependency:** the OpenTelemetry packages are optional peers:

```bash
npm install @opentelemetry/api @opentelemetry/api-logs @opentelemetry/sdk-logs \
            @opentelemetry/exporter-logs-otlp-http @opentelemetry/resources \
            @opentelemetry/semantic-conventions
```

If your application already builds its own OTel pipeline, pass an existing
`loggerProvider` and none of the SDK packages are required by this plugin.

**Setup:**

```javascript
{
    name: 'OpenTelemetry',
    enabled: true,
    config: {
        // --- Collector endpoint (used when no `exporter`/`loggerProvider` is given) ---
        url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || 'http://localhost:4318/v1/logs',
        headers: { 'x-api-key': process.env.OTEL_API_KEY },
        concurrencyLimit: 10,        // Optional: max in-flight export requests
        timeoutMillis: 10000,        // Optional: export request timeout

        // --- Resource attributes ---
        serviceName: 'my-service',   // Optional: sets service.name
        serviceVersion: '1.2.3',     // Optional: sets service.version
        resourceAttributes: { 'deployment.environment': process.env.NODE_ENV },
        // resource: myResource,     // Optional: a pre-built OTel Resource (wins over the above)

        // --- Pipeline ---
        // exporter: myExporter,         // Optional: bring your own exporter (gRPC/protobuf/etc.)
        // loggerProvider: myProvider,   // Optional: reuse an existing LoggerProvider
        useSimpleProcessor: false,       // Optional: SimpleLogRecordProcessor instead of Batch
        processorOptions: {},            // Optional: passed to the processor constructor

        // --- Behaviour ---
        level: 'trace',              // Optional: minimum level to export (default: 'trace')
        includeTraceContext: true,   // Optional: attach trace_id/span_id (default: true)
        stripAnsi: true,             // Optional: strip ANSI codes (default: true)
        instrumentationName: 'ntlogger',  // Optional: OTel instrumentation scope name
        instrumentationVersion: '3.0.0', // Optional: OTel instrumentation scope version
    },
}
```

**Notes:**
- `level` uses ntlogger priorities (`fatal` 0 -> `internal` 6). The default `'trace'` exports everything except `internal`; use `'internal'` to export absolutely everything.
- If neither `loggerProvider` nor `exporter` is supplied and the SDK/exporter packages are not installed, the transport constructor throws a message naming the packages to install - the loader reports it and skips only this plugin.
- The plugin shuts the provider down on `close()` only when it created the provider itself; a caller-supplied `loggerProvider` is left alone.

### Example Logger Configuration
Here is an example configuration for NightTimeLogger using multiple plugins:

``` javascript

let config = {
    level: 'internal',
    file: false,
    plugins: [
        {
            name: 'Discord',
            enabled: true,
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
            enabled: true,
            config: {
                dsn: process.env.SENTRY_DSN,
                release: process.env.SENTRY_RELEASE,
                tracesSampleRate: 1.0,
                environment: process.env.NODE_ENV || 'development',
            },
        },
        {
            name: 'MySQL',
            enabled: true,
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
            enabled: true,
            config: {},
        },
        {
            name: 'Syslog',
            enabled: true,
            config: {
                host: process.env.SYSLOG_HOST || 'localhost',
                port: process.env.SYSLOG_PORT || 514,
                protocol: 'UDP',
                facility: 1,
                appName: 'MyAppLogger',
            },
        },
        {
            name: 'OpenObserve',
            enabled: true,
            config: {
                host: process.env.OPENOBSERVE_HOST || 'http://localhost:5080',
                organization: process.env.OPENOBSERVE_ORGANIZATION || 'default',
                stream: process.env.OPENOBSERVE_STREAM || 'logs',
                username: process.env.OPENOBSERVE_USERNAME,
                password: process.env.OPENOBSERVE_PASSWORD,
                batchSize: 100,
                timeThreshold: 5000,
                level: 'info',
            },
        },
        {
            name: 'OpenTelemetry',
            enabled: true,
            config: {
                url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || 'http://localhost:4318/v1/logs',
                serviceName: 'MyAppLogger',
                level: 'info',
            },
        },
    ],
};
```

Every entry above sets `enabled: true` and an object `config` - both are mandatory.
Plugins whose peer dependency is not installed (`Sentry`, `MySQL`, `Postgres`,
`OpenTelemetry`) are reported and skipped without affecting the rest of the list.

### Conclusion
The NightTimeLogger is highly customizable and supports various plugins for different logging requirements. By leveraging these plugins, you can easily integrate logging into your existing infrastructure, whether it be storing logs in databases, sending them to monitoring tools like Sentry, or receiving alerts directly in Discord.

For more details on each plugin, refer to the specific plugin files in the project.