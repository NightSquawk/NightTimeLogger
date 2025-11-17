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

Note: The `location` field represents the logger instance name, while `filePath` shows the actual call site where the log statement was written.

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