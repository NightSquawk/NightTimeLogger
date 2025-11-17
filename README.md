# NightTimeLogger

NightTimeLogger is a custom logging wrapper built on top of the Winston logging library. It provides a ready-to-go solution for integrating advanced logging functionalities into Node.js applications with ease.

[![Node.js Package](https://github.com/NightSquawk/NightTimeLogger/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/NightSquawk/NightTimeLogger/actions/workflows/main.yml)

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

## Installation

To install NightTimeLogger, use npm:

```bash
npm install ntlogger
```

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
- `maxSize`: The maximum size (in bytes) for each log file.
- `maxFiles`: The maximum number of log files to retain (rotating file strategy).
- `timestamp`: Whether to include timestamps in log messages. Defaults to `true`.
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

## Custom Levels and Colors
NightTimeLogger provides custom log levels and colors for enhanced logging experience:

### Levels:

- trace: 5
- debug: 4
- info: 3
- warn: 2
- error: 1
- fatal: 0
- internal: -1

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