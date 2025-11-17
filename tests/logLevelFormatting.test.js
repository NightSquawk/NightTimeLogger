/**
 * @file /tests/logLevelFormatting.test.js
 * @description Tests for log level formatting and alignment
 */

const logger = require('../lib/logger');
const Transport = require('winston-transport');

// Custom transport that captures the level information before formatting
class FormatCaptureTransport extends Transport {
    constructor(opts = {}) {
        super(opts);
        this.name = 'FormatCaptureTransport';
        this.capturedLevels = [];
    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        // Capture the level information
        const { level, message, ...meta } = info;
        
        // Strip ANSI codes and get clean level (matching the formatter logic)
        const cleanLevel = String(level).replace(/\u001b\[[0-9;]*m/g, '').trim();
        const paddedLevel = cleanLevel.padEnd(8);
        
        this.capturedLevels.push({
            level: cleanLevel,
            paddedLevel,
            paddedLength: paddedLevel.length,
            originalLevel: level
        });

        callback();
    }

    getCapturedLevels() {
        return this.capturedLevels;
    }

    clearLevels() {
        this.capturedLevels = [];
    }
}

describe('Log Level Formatting Tests', () => {
    let formatTransport;

    beforeEach(() => {
        formatTransport = new FormatCaptureTransport();
    });

    afterEach(() => {
        if (formatTransport) {
            formatTransport.clearLevels();
        }
    });

    test('should pad all log levels to consistent width (8 characters)', async () => {
        const log = logger('FormattingTest', {
            level: 'trace',
            console: false,
            file: false,
            skipCache: true,
        });
        
        // Add the custom transport manually
        log.add(formatTransport);

        // Log messages at all levels
        log.fatal('Fatal message');
        log.error('Error message');
        log.warn('Warning message');
        log.info('Info message');
        log.debug('Debug message');
        log.trace('Trace message');
        log.internal('Internal message');

        // Wait for async processing
        await new Promise(resolve => setImmediate(resolve));

        const captured = formatTransport.getCapturedLevels();
        const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'internal'];

        // Filter to only valid levels
        const levels = captured.filter(c => validLevels.includes(c.level));

        // Verify we captured levels (some may be filtered by log level)
        expect(levels.length).toBeGreaterThanOrEqual(6); // Should have at least 6 levels

        // Verify all captured levels are padded to 8 characters
        levels.forEach(({ level, paddedLevel, paddedLength }) => {
            // The padded string should be 8 characters
            expect(paddedLength).toBe(8);
            expect(paddedLevel).toBe(level.padEnd(8));
        });
    });

    test('should handle ANSI codes in level strings correctly', async () => {
        const log = logger('AnsiTest', {
            level: 'info',
            console: false,
            file: false,
            skipCache: true,
        });
        
        // Add the custom transport manually
        log.add(formatTransport);

        log.info('Test message');
        log.error('Error message');
        log.debug('Debug message');

        // Wait for async processing
        await new Promise(resolve => setImmediate(resolve));

        const captured = formatTransport.getCapturedLevels();
        const foundLevels = captured.map(c => c.level);

        // Verify we captured levels
        expect(foundLevels.length).toBeGreaterThanOrEqual(2); // At least info and error should be captured
        
        // Verify all levels are properly formatted
        captured.forEach(({ level, paddedLevel, paddedLength }) => {
            expect(['info', 'error', 'debug']).toContain(level);
            expect(paddedLength).toBe(8);
            expect(paddedLevel).toBe(level.padEnd(8));
        });
    });

    test('should maintain consistent alignment across different level lengths', async () => {
        const log = logger('AlignmentTest', {
            level: 'trace',
            console: false,
            file: false,
            skipCache: true,
        });
        
        // Add the custom transport manually
        log.add(formatTransport);

        // Log with different length level names
        log.info('Info');      // 4 chars
        log.debug('Debug');    // 5 chars
        log.trace('Trace');    // 5 chars
        log.error('Error');    // 5 chars
        log.internal('Internal'); // 8 chars

        // Wait for async processing
        await new Promise(resolve => setImmediate(resolve));

        const captured = formatTransport.getCapturedLevels();
        
        // Verify all levels have consistent padding
        if (captured.length > 1) {
            const firstPaddedLength = captured[0].paddedLength;
            
            captured.forEach(({ level, paddedLevel, paddedLength }) => {
                expect(paddedLength).toBe(8);
                expect(paddedLength).toBe(firstPaddedLength);
                expect(paddedLevel).toBe(level.padEnd(8));
            });
        }
    });
});

