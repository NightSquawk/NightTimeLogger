/**
 * @file /plugins/smsMail.js
 * @description Sends logs via SMS using an email-to-SMS gateway.
 */

const Transport = require('winston-transport');
const { spawn } = require('child_process');
const os = require('os');

const levels = require('../lib/levels');

class SMSTransport extends Transport {
    constructor(opts = {}) {
        super(opts);

        this.name = 'SMS Transport for NTLogger';

        // Required options for the SMTP transport
        this.smsMailId = opts.smsMailId; // SMS email gateway address (e.g., 1234567890@carrier.com)
        this.from = opts.from || `noreply@${os.hostname()}`; // Default from address
        this.subjectPrefix = opts.subjectPrefix || 'Log Notification'; // Subject prefix for emails
        this.smtpCommand = opts.smtpCommand || 'msmtp'; // Default to msmtp if no command provided

        this.strict = opts.strict || false;

        try {
            this.level = opts.level || 'info';
            if (!(this.level in levels)) {
                throw new Error(`Invalid log level: ${this.level}`);
            }
            this.levelPriority = levels[this.level];
        } catch (error) {
            console.error(`Error setting log level: ${error.message}`);
            console.error(error.stack);
            throw error;
        }
    }

    async log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

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

        // Construct the email content
        const emailSubject = `${this.subjectPrefix}: ${level.toUpperCase()}`;
        const emailText = `${message}\n\n${JSON.stringify(meta, null, 2)}`;

        // Use the configured SMTP command to send the email
        const smtpProcess = spawn(this.smtpCommand, ['-t']);

        // Write the email content
        smtpProcess.stdin.write(`To: ${this.smsMailId}\n`);
        smtpProcess.stdin.write(`From: ${this.from}\n`);
        smtpProcess.stdin.write(`Subject: ${emailSubject}\n`);
        smtpProcess.stdin.write('\n'); // End of headers
        smtpProcess.stdin.write(`${emailText}\n`);
        smtpProcess.stdin.end();

        smtpProcess.on('error', (err) => {
            console.error(`Failed to send log via SMS: ${err.message}`);
            console.error(`Please provide information for a valid SMTP server to use.`);
        });

        smtpProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`SMTP process exited with code ${code}`);
                console.error(`Ensure that the SMTP server information is correct.`);
            }
            callback();
        });
    }
}

module.exports = {
    transport: SMSTransport,
};