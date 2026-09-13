# NightTimeLogger

NightTimeLogger is a custom logging wrapper built on top of the Winston logging library. It provides a ready-to-go solution for integrating advanced logging functionalities into Node.js applications with ease.

[![Node.js Package](https://github.com/NightSquawk/NightTimeLogger/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/NightSquawk/NightTimeLogger/actions/workflows/main.yml)

This maintenance update requires Node.js 22.22.2 or newer; Node 22 and 24 are tested.

Process signal handling is now **opt-in**. Applications that relied on automatic shutdown must register it once:

```javascript
const logger = require('ntlogger');
const unregister = logger.setupSignalHandlers({ timeout: 30000 });
```

Alternatively, keep your application's own shutdown handlers and `await log.close()` there. Importing the package no longer changes process exception or signal handling. Flush and close reject on delivery errors/timeouts, so callers should handle rejected promises. Close is idempotent, waits for transport cleanup, and removes the logger from its cache. Children share their parent's transports; closing a child flushes but does not close the parent. On this Winston API, log calls after close throw an error. See the Pino lifecycle note below for its different behavior.

OpenTelemetry users must upgrade the logs SDK/API/HTTP exporter together to `^0.222.0` and resources to `^2.11.0`. Earlier SDK versions are no longer advertised as compatible. Database transports now own separate pools, use event timestamps in UTC, accept `ssl` configuration, and require simple SQL table identifiers. Existing tables are not altered automatically.

## Features

- Custom log levels for fine-grained control over logging output.
- Dynamic color generation for visually appealing log messages.
- Custom session ID generation for tracking log sessions.
- Support for both file and console log formatters.
- Ability to configure log levels and formats to suit specific requirements.
- Native call site path reporting - automatically capture file path, line number, and call chain where each log statement is executed.
- **Child loggers** - Create contextual loggers with persistent metadata (perfect for multi-threaded applications).
- **Log sampling and rate limiting** - Reduce console spam with configurable sampling rates and rate limits per log level.
- **Log deduplication** - Automatically group and squish duplicate log messages (e.g., "Ticket already exists (x11)").
- **Performance metrics** - Development-only performance tracking with `time()` and `timeEnd()` methods.
- **Non-blocking operations** - All logging operations are asynchronous and won't block your application.
- **TypeScript support** - Full TypeScript definitions included for excellent IDE integration (IntelliJ, VS Code, etc.).
- [Log Contract](docs/log-contract.md) — cross-language field, level, context, redaction, and OTLP mapping contract shared by Node, Python, and Rust emitters.

## Installation

To install NightTimeLogger, use npm:

```bash
npm install ntlogger
```

The core package depends only on `winston` and `winston-transport`, so a default
install stays small.

### Optional plugin backends

Plugin backends are **optional peer dependencies** - they are not installed for you.
Install only the ones whose plugins you actually enable:

| Plugin | Install |
| --- | --- |
| Sentry | `npm install @sentry/node` |
| MySQL | `npm install mysql2` |
| Postgres | `npm install pg` |
| OpenTelemetry | `npm install @opentelemetry/api @opentelemetry/api-logs @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions` |
| Discord, Teams, OpenObserve, Syslog, Jest | none - no extra packages required |

Plugin modules are resolved lazily, so a missing peer never breaks
`require('ntlogger')`. The loader reports an actionable error naming the package and
the install command, skips that one plugin, and keeps every other plugin working.
See [plugins/README.md](https://github.com/NightSquawk/NightTimeLogger/blob/main/plugins/README.md)
for per-plugin configuration.

> **Upgrading:** `@sentry/node`, `mysql2` and `pg` used to be hard dependencies of
> `ntlogger`. If you relied on them being installed transitively, add them to your own
> `package.json`.

## Usage

```javascript
// Import the logger
const logger = require('ntlogger');

// Create a logger instance
const log = logger('MyApp');

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');
```

## Output

Check out [Quick Start](https://github.com/NightSquawk/NightTimeLogger/blob/main/examples/quick-start.js)
![Quick Start](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/quick-start.png)


Check out [Full Configuration](https://github.com/NightSquawk/NightTimeLogger/blob/main/examples/full-configuration.js)
![Full Configuration](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/full-configuration.png)

## Configuration Options

- `level`: The default log level for the logger instance.
- `console`: Whether to enable console logging. Defaults to `true`.
- `file`: Whether to enable file logging. Defaults to `true`.
- `path`: The directory path where log files will be saved.
- `filename`: Combined log filename (default: `combined.log`); error/fatal files retain their names.
- `shutdownTimeout`: Maximum wait in milliseconds for flush or stream shutdown (default: `30000`).
- `maxSize`: The maximum size (in bytes) for each log file.
- `maxFiles`: The maximum number of log files to retain (rotating file strategy).
- `timestamp`: Whether to include timestamps in log messages. Defaults to `true`.
- `skipCache`: Whether to bypass the logger instance cache and always build a new instance for this location name. Defaults to `false` (instances are cached per location name; child loggers always skip the cache).
- `plugins`: Array of plugin configurations, each `{ name, enabled, config }`. All three fields are required - `enabled` must be `true` and `config` must be an object (use `{}` when the plugin takes no options), otherwise the plugin is skipped. Backends whose optional peer dependency is missing are reported and skipped without affecting the others. Defaults to `[]`.
- `debug`: Whether to enable debug mode, which logs internal messages. Defaults to `false`.
- `reportPath`: Whether to enable call site path reporting. When enabled, automatically captures the file path, line number, column number, and call chain where each log statement is executed. The path is added as metadata (JSON field `filePath`), not in the formatted message string. Defaults to `false`.
- `sampling`: Object with level-based sampling rates (e.g., `{ debug: 0.01, trace: 0.001 }`). Values between 0.0 and 1.0, where 1.0 = log all, 0.1 = log 10%. Defaults to `{}` (no sampling).
- `rateLimit`: Object with level-based rate limits (e.g., `{ error: { max: 10, window: 60000 } }`). Prevents console spam by limiting logs per level within a time window. Defaults to `{}` (no rate limiting).
- `deduplication`: Object with `{ enabled: boolean, threshold: number, window: number }`. Groups similar log messages and squishes duplicates (e.g., "Ticket already exists (x11)"). Defaults to `{ enabled: false, threshold: 3, window: 60000 }`.
- `performanceMetrics`: Enable performance tracking (default: `NODE_ENV === 'development'`). Adds `time()` and `timeEnd()` methods.
- `statsInterval`: Interval in milliseconds to automatically log statistics (default: `0` = disabled). Useful for tuning sampling/rate limiting parameters.

### Call Site Path Reporting

When `reportPath` is enabled, each log entry includes a `filePath` field in its metadata showing where the log was called:

```javascript
const logger = require('ntlogger');

const log = logger('MyApp', {
    reportPath: true
});

log.info('User logged in'); // filePath will show: "./src/routes/auth.js:45:12 [handleLogin ← router.post]"
```

The `filePath` field appears in:
- JSON metadata (for plugins like OpenObserve)
- Console output (appended to location)
- File logs (appended to location)

**Smart Internal Function Filtering**: The logger automatically filters out internal Node.js functions (like `_onTimeout`, `listOnTimeout`, `setImmediate`, etc.) from the call chain, ensuring you only see your actual application code. This works even when logs are called from within `setTimeout`, `setImmediate`, or Promise callbacks.

Note: The `location` field represents the logger instance name, while `filePath` shows the actual call site where the log statement was written.

### Child Loggers

Create child loggers with persistent context that's automatically merged into all log entries. Perfect for request-scoped logging or multi-threaded applications:

```javascript
const logger = require('ntlogger');

const log = logger('MyApp');

// Create a child logger with context
const requestLogger = log.child({ 
    requestId: 'abc123', 
    userId: 456,
    endpoint: '/api/users' 
});

// All logs from requestLogger automatically include the context
requestLogger.info('Processing request'); 
// Logs: { requestId: 'abc123', userId: 456, endpoint: '/api/users', message: 'Processing request' }

// Support nested children
const operationLogger = requestLogger.child({ operation: 'validate' });
operationLogger.debug('Validating input'); // Includes all parent context
```

### Log Sampling and Rate Limiting

Reduce console spam with configurable sampling and rate limiting:

```javascript
const log = logger('MyApp', {
    // Sample 1% of debug logs, 0.1% of trace logs
    sampling: {
        debug: 0.01,
        trace: 0.001
    },
    // Limit errors to 10 per minute
    rateLimit: {
        error: { max: 10, window: 60000 }
    },
    // Log statistics every 5 minutes to help tune parameters
    statsInterval: 300000
});

// Get statistics
const stats = log.getStats();
console.log(stats);
// {
//   sampling: { total: { error: 150 }, sampled: { debug: 99 }, rateLimited: { error: 5 } },
//   deduplication: { totalDeduplicated: 50, uniqueMessages: 20 },
//   performance: { enabled: true, avgLogProcessingTime: 0.5 }
// }
```

### Log Deduplication

Automatically group and squish duplicate log messages:

```javascript
const log = logger('MyApp', {
    deduplication: {
        enabled: true,
        threshold: 3,  // After 3 duplicates, start squishing
        window: 60000  // 60 second window
    }
});

// If this message appears 11 times:
log.debug('Ticket already exists for threshold a481199f-ed1c-47c6-834d-9cf54cdc394e and device 2642');

// It will be logged once as:
// "Ticket already exists for threshold * and device * (x11)"
```

### Performance Metrics (Development Only)

Track performance in development mode:

```javascript
const log = logger('MyApp', {
    performanceMetrics: true  // Auto-enabled in development
});

log.time('database-query');
// ... do work ...
const duration = log.timeEnd('database-query');
// Logs: "Timer 'database-query' completed in 45.23ms"
```

### Non-Blocking Operations

All logging operations are non-blocking and return immediately:

```javascript
const log = logger('MyApp');

// All these return immediately, processing happens asynchronously
log.info('Message 1');
log.info('Message 2');
log.info('Message 3');

// Flush all pending logs (returns Promise)
await log.flush();

// Close logger gracefully (returns Promise)
await log.close();
```

## Pino Support

`ntlogger/pino` is a separate entry point for projects that already use [Pino](https://getpino.io).
It provides an NTL-styled transport plus `createLogger()`, which wires the NTL conventions
(module label, structured context, secret redaction, sampling, graceful shutdown) onto a real
Pino logger.

`pino` is an optional peer dependency and `split2` an optional dependency — Winston-only users
install neither.

### Transport only

```javascript
const pino = require('pino');

const log = pino({
  transport: { target: 'ntlogger/pino', options: { colorize: true, defaultModule: 'MyApp' } },
});

log.info({ tenantId: 'acme' }, 'server started');
// 2025-01-01 12:00:00 [info    ] [MyApp]: {tenantId=acme} server started
```

The transport renders a dim `{key=value ...}` suffix for the top-level context keys
`tenantId`, `userId`, `correlationId`, `traceId`, `spanId`, `jobId`, `agentUuid`, `commandId`
(exported as `CONTEXT_KEYS`), and pairs pino-http/Fastify request/response lines.

### `createLogger(opts)`

```javascript
const { createLogger } = require('ntlogger/pino');

const log = createLogger({ module: 'OrderService', service: 'checkout-api' });

log.info({ tenantId: 'acme' }, 'order received');
```

`createLogger()` returns a **real Pino logger**, so the call signature is object-first:
`log.info({ tenantId }, 'message')` — not Winston's `log.info('message', meta)`.

In development it attaches the NTL transport for human-readable output; with
`NODE_ENV=production` it writes plain NDJSON so log shippers get clean JSON.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `level` | `string` | `LOG_LEVEL`, else `debug` (dev) / `info` (production) | Pino level. |
| `module` | `string` | — | Adds `module` to every line and labels the transport output. |
| `defaultModule` | `string` | — | Transport label when `module` is not set. |
| `colorize` | `boolean` | transport default | Forwarded to the NTL transport. |
| `service` | `string` | — | Constant top-level `service` field (a core field of the log contract). |
| `context` | `object` | — | Static top-level fields merged into every line. |
| `contextProvider` | `() => object` | — | Called per log call; its result is merged at the top level. |
| `contextKeys` | `string[]` | — | When set, only these keys are taken from the provider result. |
| `redact` | `false \| string[] \| object` | defaults on | Secret redaction (see below). |
| `sampling` | `object` | — | Per-level sampling rates, same shape as the Winston path. |
| `rateLimit` | `object` | — | Per-level rate limits, same shape as the Winston path. |
| `deduplication` | `object \| boolean` | — | Duplicate-message collapsing, same shape as the Winston path. |
| `silent` | `boolean` | see below | Force silent mode on or off. |
| `processHandlers` | `boolean \| object` | `false` | Opt-in crash/signal handlers. |
| `destination` | Pino destination | — | Test/advanced escape hatch; replaces the NTL transport. |

The returned logger additionally exposes `getStats()`, `resetStats()`, `close(timeout?)` and —
when `processHandlers` is used — `uninstallProcessHandlers()`. These are own properties of the
returned instance, so `logger.child()` inherits them without anything being written to Pino's
shared prototype.

### Request context with AsyncLocalStorage

```javascript
const { AsyncLocalStorage } = require('async_hooks');
const { createLogger } = require('ntlogger/pino');

const als = new AsyncLocalStorage();

const log = createLogger({
  module: 'API',
  context: { region: 'us-east-1' },          // constant
  contextProvider: () => als.getStore(),     // per call
  contextKeys: ['tenantId', 'userId', 'correlationId'],
});

app.use((req, res, next) => als.run({ tenantId: req.tenantId, correlationId: req.id }, next));

log.info('handled');       // -> { module: 'API', region: 'us-east-1', tenantId: ..., correlationId: ... }
log.info({ tenantId: 'override' }, 'handled');
```

Precedence, lowest to highest:

`service`/`pid`/`hostname` → `module` → `context` → `contextProvider` → fields passed on the log call.

`contextKeys` lets an application hand the provider a large store and expose only a few fields.
A provider that throws never breaks logging: the context is dropped and a single
`NTLoggerContextWarning` is emitted via `process.emitWarning`. Non-object return values
(including arrays and `null`) are ignored.

### Secret redaction

Redaction is **on by default**. It covers the message string, string and plain-object
interpolation arguments, the merge object (recursively), `Error` messages and stacks, and child
bindings. Keys such as `password`, `token`, `authorization`, `apiKey` and `cookie` are replaced
wholesale; known secret shapes (Bearer/Basic headers, JWTs, AWS/GitHub/Slack/Stripe keys, PEM
blocks, URL credentials, Discord webhook tokens) are replaced inside free text.

```javascript
createLogger({ redact: false });                         // disable entirely
createLogger({ redact: ['deviceFingerprint'] });         // add app-specific key names
createLogger({ redact: ['payload.cardNumber'] });        // Pino-style path -> Pino's own redact
createLogger({ redact: { replacement: '***', extraPatterns: [/CUST-\d{8}/g] } });
```

A string array is split: entries containing `.`, `[`, `]` or `*` are forwarded to Pino's native
`redact` option (which replaces with Pino's `[Redacted]`), everything else becomes `extraKeys`
for ntlogger's redactor (which replaces with `[REDACTED]`). An object is passed straight to
`createRedactor()` and accepts `keys`, `extraKeys`, `patterns`, `extraPatterns`, `replacement`,
`maxDepth` and `maxStringLength`.

```javascript
log.error(new Error('payment failed for Bearer abc123def456...'));
// -> { "err": { "type": "Error", "message": "payment failed for Bearer [REDACTED]", "stack": "..." },
//      "msg": "payment failed for Bearer [REDACTED]" }
```

### Sampling, rate limiting and deduplication

The same configuration shapes as the Winston path (see *Log Sampling and Rate Limiting* and
*Log Deduplication*), applied through Pino's single `hooks.logMethod`.

```javascript
const log = createLogger({
  module: 'Ingest',
  sampling: { debug: 0.1 },
  rateLimit: { info: { max: 100, window: 60000 } },
  deduplication: { enabled: true, threshold: 3, window: 60000 },
});

log.getStats();    // { sampling: {...}, deduplication: {...} }
log.resetStats();
await log.close(); // releases the sampler/dedup timers, then flushes the destination
```

`fatal` is never sampled, rate limited or deduplicated unless the configuration names it
explicitly. Zero-config loggers install no feature hook at all.

### Silent mode

Resolution order:

1. `opts.silent`, when it is a boolean
2. `NTLOGGER_SILENT` — `1`/`true`/`yes` → silent, `0`/`false`/`no` → not silent
3. `NODE_ENV === 'test'` or nonempty `NODE_TEST_CONTEXT` → silent

A silent logger runs at Pino level `silent`, attaches no transport and installs no hooks, so
test suites pay nothing for logging. `isSilent(opts)` is exported for testing the resolution.

```javascript
const log = createLogger({ module: 'API' });          // silent under Jest (NODE_ENV=test)
const log = createLogger({ module: 'API', silent: false }); // force output in a test
```

Node's built-in test runner is detected through `NODE_TEST_CONTEXT`; `node --test`
scripts no longer need `NTLOGGER_SILENT=1` for the Pino API.

### Fastify integration

Use the plain options factory to retain Fastify's normal route logger types:

```javascript
const Fastify = require('fastify');
const { createPinoOptions } = require('ntlogger/pino');

const app = Fastify({
  logger: createPinoOptions({
    service: 'api',
    contextProvider: () => requestContext.getStore(), // your AsyncLocalStorage
    serializers: {
      req: req => ({ method: req.method, url: req.url, headers: req.headers }),
      res: reply => ({ statusCode: reply.statusCode, headers: reply.getHeaders() }),
    },
  }),
});
app.addHook('preHandler', async req => {
  req.log.debug({ body: req.body }, 'parsed request body');
});
```

The factory emits JSON options without creating a transport or installing process
handlers. Fastify owns the logger and shutdown. It shares `createLogger()`'s
service/module fields, context provider, silent-mode resolution, and redaction.
Default request/response serializers retain Fastify's summary fields; headers and
bodies are opt-in. Bodies are available after parsing, not in the initial request
log. See [Fastify's logging documentation](https://fastify.dev/docs/latest/Reference/Logging/).

Pass custom serializers **into the factory** so redaction runs on their output.
Replacing returned formatters, hooks, or serializers (including route-level serializer
overrides) can bypass protection. Ordinary log objects, message strings, and serialized
request/response/error fields are redacted. Arbitrary child bindings are not covered by
the factory's general deep redactor: keep them to identifiers such as `reqId` and
`tenantId`, or protect specific binding paths with `redact: ['account.secret']`.
`createLogger()` additionally redacts arbitrary child bindings.

Sampling, rate limiting, deduplication, destinations, and process handlers are not
accepted by this factory; use `createLogger()` for those features. Framework-owned
loggers do not gain ntlogger's `getStats()`, `resetStats()`, or `close()` methods.

### Capturing test logs

```javascript
const { createTestLogger } = require('ntlogger/pino');
const { logger, records } = createTestLogger();
logger.child({ jobId: 'j1' }).warn({ password: 'secret' }, 'retry');
// records[0] includes level: 40, jobId: 'j1', password: '[REDACTED]', msg: 'retry'
await logger.close();
```

Records are captured synchronously after Pino serialization and redaction, with no
console output or worker transport. The helper defaults to level `trace` and overrides
automatic/environment silence; explicit `silent: true` still captures nothing.
Sampling and level filtering apply normally. Clear captured records with
`records.length = 0` when needed.

### Pino lifecycle

Pino's `close()` helper releases feature timers and drains buffered output. It does
not mark the logger closed or guarantee that subsequent calls throw. A supplied
writable destination may still accept writes; an ended transport may reject them.
Stop producers before closing, and do not reuse the logger afterward. The Winston
API enforces a closed-state error; this distinction is intentional documentation of
the current behavior, not a new lifecycle guarantee.

### Process handlers

Opt-in only — importing the library never installs process listeners.

```javascript
const log = createLogger({
  module: 'API',
  processHandlers: {
    timeout: 4000,
    signals: ['SIGTERM', 'SIGINT'],
    onShutdown: async reason => { await server.close(); },
  },
});

// later
log.uninstallProcessHandlers();
```

`installProcessHandlers(logger, opts)` and `drainLogger(logger, timeout)` are also exported
directly for loggers not built by `createLogger()`.

See `examples/pino-advanced.js` for all of the above in one runnable file.

## Custom Levels and Colors
NightTimeLogger provides custom log levels and colors for enhanced logging experience:

### Levels:

- trace: 5
- debug: 4
- info: 3
- warn: 2
- error: 1
- fatal: 0
- internal: 6

### Colors:

- trace: Light gray
- debug: White
- info: Green
- warn: Yellow
- error: Red
- fatal: Magenta
- internal: Bright yellow

## File and Console Formatters
NightTimeLogger supports both file and console log formatters. File-formatted logs are stored in the project's root `/logs` directory.

## License
NightTimeLogger is licensed under the [GPL-3.0 License](https://opensource.org/licenses/GPL-3.0).
## Maintenance checks

Run `npm ci` and `npm run test:coverage` for the complete suite. MySQL and PostgreSQL integration tests start disposable Docker containers; CI sets `REQUIRE_DOCKER_TESTS=1` so they cannot silently skip. `npm run test:unit` excludes those two Docker suites for local work. `npm audit` checks all dependencies; `npm audit --omit=dev` checks production dependencies.

HTTP transports (Discord, Teams, OpenObserve) accept `timeout` (5000 ms per attempt), `maxRetries` (3), `retryDelay` (1000 ms), and `maxPending` (100 outstanding deliveries). They retry connection failures, HTTP 429 and 5xx with bounded backoff. Queue overflow, terminal HTTP errors, and timeouts surface through callbacks/flush. Delivery is best-effort with retries, not durable storage; an ambiguous network failure can lead to a duplicate on retry. OpenObserve retains batching and flush now waits for responses. Increase `shutdownTimeout` if you configure longer retries.
