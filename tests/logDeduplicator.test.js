/**
 * @file /tests/logDeduplicator.test.js
 * @description Tests for logDeduplicator module
 */

const { LogDeduplicator } = require('../lib/logDeduplicator');

describe('LogDeduplicator Tests', () => {
    test('should not deduplicate when disabled', () => {
        const deduplicator = new LogDeduplicator({ enabled: false });
        const result1 = deduplicator.check('info', 'Test message', {});
        const result2 = deduplicator.check('info', 'Test message', {});
        
        expect(result1).toBeNull();
        expect(result2).toBeNull();
    });

    test('should deduplicate similar messages', () => {
        const deduplicator = new LogDeduplicator({
            enabled: true,
            threshold: 3,
            window: 60000
        });
        
        const message = 'Ticket already exists for threshold a481199f-ed1c-47c6-834d-9cf54cdc394e and device 2642';
        
        // First occurrence returns object with shouldLog: true
        const result1 = deduplicator.check('debug', message, {});
        expect(result1).not.toBeNull();
        expect(result1.shouldLog).toBe(true);
        expect(result1.count).toBe(1);
        
        const result2 = deduplicator.check('debug', message, {});
        expect(result2.shouldLog).toBe(true);
        expect(result2.count).toBe(2);
        
        const result3 = deduplicator.check('debug', message, {});
        expect(result3.shouldLog).toBe(true);
        expect(result3.count).toBe(3);
        
        // 4th should be squished (count > threshold, so shouldLog is false)
        const result4 = deduplicator.check('debug', message, {});
        expect(result4).not.toBeNull();
        expect(result4.shouldLog).toBe(false); // Above threshold, suppressed
        expect(result4.count).toBe(4);
        expect(result4.message).toContain('(x4)');
    });

    test('should handle different messages separately', () => {
        const deduplicator = new LogDeduplicator({
            enabled: true,
            threshold: 2,
            window: 60000
        });
        
        const result1 = deduplicator.check('info', 'Message 1', {});
        const result2 = deduplicator.check('info', 'Message 2', {});
        
        expect(result1).not.toBeNull();
        expect(result1.shouldLog).toBe(true);
        expect(result2).not.toBeNull();
        expect(result2.shouldLog).toBe(true);
    });

    test('should get statistics', () => {
        const deduplicator = new LogDeduplicator({
            enabled: true,
            threshold: 2,
            window: 60000
        });
        
        deduplicator.check('info', 'Test message', {});
        deduplicator.check('info', 'Test message', {});
        deduplicator.check('info', 'Test message', {});
        
        const stats = deduplicator.getStats();
        expect(stats.totalDeduplicated).toBeGreaterThan(0);
        expect(stats.uniqueMessages).toBeGreaterThan(0);
    });

    test('should cleanup old entries', async () => {
        const deduplicator = new LogDeduplicator({
            enabled: true,
            threshold: 2,
            window: 100 // Short window for testing
        });
        
        deduplicator.check('info', 'Test message', {});
        
        // Wait for window to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Should be cleaned up
        const stats = deduplicator.getStats();
        expect(stats.activeEntries).toBe(0);
    });

    test('should destroy and cleanup', () => {
        const deduplicator = new LogDeduplicator({
            enabled: true,
            threshold: 2,
            window: 60000
        });
        
        deduplicator.destroy();
        // Should not throw
        expect(() => deduplicator.check('info', 'Test', {})).not.toThrow();
    });
});

