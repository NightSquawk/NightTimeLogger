/**
 * @file /tests/messageNormalizer.test.js
 * @description Tests for messageNormalizer module
 */

const { normalizeMessage } = require('../lib/messageNormalizer');

describe('MessageNormalizer Tests', () => {
    test('should normalize UUIDs', () => {
        const message = 'Ticket already exists for threshold a481199f-ed1c-47c6-834d-9cf54cdc394e';
        const normalized = normalizeMessage(message);
        expect(normalized).toBe('Ticket already exists for threshold *');
    });

    test('should normalize device IDs', () => {
        const message = 'Ticket already exists for threshold a481199f-ed1c-47c6-834d-9cf54cdc394e and device 2642';
        const normalized = normalizeMessage(message);
        expect(normalized).toBe('Ticket already exists for threshold * and device *');
    });

    test('should normalize timestamps', () => {
        const message = 'Error occurred at 2025-11-17 10:30:45';
        const normalized = normalizeMessage(message);
        // The regex matches YYYY-MM-DD HH:mm:ss format
        expect(normalized).toContain('Error occurred at');
        expect(normalized).not.toContain('2025-11-17 10:30:45');
    });

    test('should normalize large numbers', () => {
        const message = 'Processing request 12345';
        const normalized = normalizeMessage(message);
        expect(normalized).toBe('Processing request *');
    });

    test('should keep small numbers', () => {
        const message = 'Found 3 items out of 10';
        const normalized = normalizeMessage(message);
        expect(normalized).toBe('Found 3 items out of 10');
    });

    test('should handle non-string input', () => {
        // Pass a non-string (number) as input to ensure normalization works and does not throw
        const normalized = normalizeMessage(12345);

        // Should always return a string, regardless of input type
        expect(typeof normalized).toBe('string');
        // Should not be undefined/null, function should not crash or throw
        expect(normalized).toBeDefined();

        // For this input, normalization should replace 5+ digit numbers with *
        expect(normalized).toBe('*');
    });
});

