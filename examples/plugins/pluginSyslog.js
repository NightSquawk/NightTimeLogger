// Import the logger
// const logger = require('ntlogger');

require('dotenv').config();
const logger = require('../../lib/logger');

let config = {
    level: 'internal',
    file: false,
    console: true,
    plugins: [
        {
            name: 'Syslog',
            enabled: true,
            config: {
                // The hostname or IP address of the Syslog server to which logs will be sent.
                // 'localhost' means the Syslog server is running on the same machine.
                host: 'localhost',

                // The port number on which the Syslog server is listening.
                // 514 is the default port for Syslog over UDP.
                port: 514,

                // The protocol used to send logs to the Syslog server.
                // Options:
                // 'UDP' - User Datagram Protocol, a lightweight and fast connectionless protocol.
                // 'TCP' - Transmission Control Protocol, provides reliable, ordered, and error-checked delivery of data.
                // 'TLS' - Transport Layer Security, adds encryption and security to the TCP connection.
                // In this case, 'UDP' is chosen for simplicity and speed.
                protocol: 'UDP',

                // The Syslog message format to use.
                // Options:
                // 'RFC-3164' - The traditional BSD Syslog format, simpler and widely supported.
                // 'RFC-5424' - The newer Syslog format with enhanced features like structured data and precise timestamps.
                // Here, 'RFC-5424' is chosen for its advanced features.
                rfc: 'RFC-5424',

                // The facility code that identifies the type of program sending the message.
                // Facility codes range from 0 to 23 and are used to categorize messages.
                // Common facility codes:
                // 0 - kernel messages
                // 1 - user-level messages
                // 3 - system daemons
                // 16 to 23 - local use (local0 to local7)
                // '1' typically represents user-level messages.
                facility: 1,

                // The name of the application that is sending the logs.
                // This is useful for identifying the source of the logs in a centralized Syslog server.
                appName: 'Plugin Example - Syslog',

                // The minimum level of logs that should be sent to the Syslog server.
                // Log levels (from highest to lowest severity):
                // 'fatal' (2) - Critical conditions, usually requiring immediate attention.
                // 'error' (3) - Error conditions.
                // 'warn' (4) - Warning conditions.
                // 'info' (6) - Informational messages.
                // 'debug' (7) - Debug-level messages, typically only useful for developers.
                // By setting this to 'debug', all logs with a level of 'debug' or higher severity will be sent.
                level: 'internal',
            },
        },
    ],
}

startSyslogServer();

// Create a logger instance
const log = logger('Plugin Example - Syslog', config);

// Log messages at different levels
log.info('Informational message');
log.warn('Warning message');
log.error('Error message');
log.debug('Debugging message');
log.trace('Trace message');

// Log internal messages
log.internal('Internal message');













// ---- Syslog Server ----

function startSyslogServer() {
    const dgram = require('dgram');
    const server = dgram.createSocket('udp4');

    server.on('message', (msg, rinfo) => {
        console.log(`Syslog Server received message: ${msg} from ${rinfo.address}:${rinfo.port}`);
    });

    server.on('error', (err) => {
        console.error(`Syslog Server error: ${err.stack}`);
        server.close();
    });

    server.on('listening', () => {
        const address = server.address();
        console.log(`Syslog Server listening on ${address.address}:${address.port}`);
    });

    server.bind(514); // Bind the server to the default Syslog UDP port (514)
}