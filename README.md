# NightTimeLogger

NightTimeLogger is a custom logging wrapper built on top of the Winston logging library. It provides a ready-to-go solution for integrating advanced logging functionalities into Node.js applications with ease.

## Features

- Custom log levels for fine-grained control over logging output.
- Dynamic color generation for visually appealing log messages.
- Custom session ID generation for tracking log sessions.
- Support for both file and console log formatters.
- Ability to configure log levels and formats to suit specific requirements.

## Installation

To install NightTimeLogger, use npm:

```bash
npm install ntlogger
```

## Usage

```javascript
// Import the logger
const logger = require('../lib/logger');

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
Quick Start
![Quick Start](https://github.com/NightSquawk/NightTimeLogger/blob/main/images/quick-start.png)

Full Configuration
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