/**
 * @file /tests/advanced-features.test.js
 * @description Tests for advanced features: child loggers, reportPath, etc.
 */

const logger = require('../lib/logger');

describe('Advanced Features Tests', () => {
    beforeEach(() => {
        // Clear any existing loggers
    });

    test('should create child logger with context', async () => {
        const parentLogger = logger('ParentTest', {
            level: 'info',
            console: false,
            file: false,
            skipCache: true,
            plugins: [{ name: 'Jest', enabled: true, config: {} }],
        });
        
        const childLogger = parentLogger.child({
            requestId: 'req-123',
            userId: 456
        });
        
        const jestTransport = childLogger.transports.find(t => t.name === 'JestTransport');
        jestTransport.clearMessages();
        
        childLogger.info('Test message');
        
        await new Promise(resolve => setImmediate(resolve));
        
        const messages = jestTransport.getMessages('info');
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0].meta.requestId).toBe('req-123');
        expect(messages[0].meta.userId).toBe(456);
    });

    test('should include filePath when reportPath is enabled', async () => {
        const log = logger('ReportPathTest', {
            level: 'info',
            console: false,
            file: false,
            skipCache: true,
            reportPath: true,
            plugins: [{ name: 'Jest', enabled: true, config: {} }],
        });
        
        const jestTransport = log.transports.find(t => t.name === 'JestTransport');
        jestTransport.clearMessages();
        
        log.info('Test message');
        
        await new Promise(resolve => setImmediate(resolve));
        
        const messages = jestTransport.getMessages('info');
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0].meta.filePath).toBeDefined();
        expect(messages[0].meta.filePath).toContain('.test.js');
    });

    test('should apply sampling to debug logs', async () => {
        const log = logger('SamplingTest', {
            level: 'debug',
            console: false,
            file: false,
            skipCache: true,
            sampling: { debug: 0.1 }, // 10% sampling
            plugins: [{ name: 'Jest', enabled: true, config: {} }],
        });
        
        const jestTransport = log.transports.find(t => t.name === 'JestTransport');
        jestTransport.clearMessages();
        
        // Send 5000 debug messages for better statistical validation
        const totalMessages = 5000;
        for (let i = 0; i < totalMessages; i++) {
            log.debug(`Debug message ${i}`);
        }
        
        await new Promise(resolve => setImmediate(resolve));
        
        const messages = jestTransport.getMessages('debug');
        const sampledCount = messages.length;
        const actualRate = sampledCount / totalMessages;
        
        // With 5000 messages at 10% sampling, we expect ~500 messages
        // Allow 5% margin: 7.5% to 12.5% (375 to 625 messages)
        // This ensures the sampling rate is approximately correct
        expect(sampledCount).toBeGreaterThanOrEqual(375);
        expect(sampledCount).toBeLessThan(625);
        
        // Verify the actual rate is close to 10%
        expect(actualRate).toBeGreaterThanOrEqual(0.075); // 7.5%
        expect(actualRate).toBeLessThanOrEqual(0.125); // 12.5%
    });

    test('should rate limit error logs', async () => {
        const log = logger('RateLimitTest', {
            level: 'error',
            console: false,
            file: false,
            skipCache: true,
            rateLimit: { error: { max: 3, window: 1000 } },
            plugins: [{ name: 'Jest', enabled: true, config: {} }],
        });
        
        const jestTransport = log.transports.find(t => t.name === 'JestTransport');
        jestTransport.clearMessages();
        
        // Send 10 error messages
        for (let i = 0; i < 10; i++) {
            log.error(`Error message ${i}`);
        }
        
        await new Promise(resolve => setImmediate(resolve));
        
        const messages = jestTransport.getMessages('error');
        // Should only have 3 (rate limited)
        expect(messages.length).toBe(3);
    });

    test('should deduplicate similar messages', async () => {
        const log = logger('DeduplicationTest', {
            level: 'debug',
            console: false,
            file: false,
            skipCache: true,
            deduplication: { enabled: true, threshold: 3, window: 60000 },
            plugins: [{ name: 'Jest', enabled: true, config: {} }],
        });
        
        const jestTransport = log.transports.find(t => t.name === 'JestTransport');
        jestTransport.clearMessages();
        
        const message = 'Ticket already exists for threshold a481199f-ed1c-47c6-834d-9cf54cdc394e and device 2642';
        
        // Send same message 5 times
        for (let i = 0; i < 5; i++) {
            log.debug(message);
        }
        
        await new Promise(resolve => setImmediate(resolve));
        
        const messages = jestTransport.getMessages('debug');
        // Should have messages, with later ones showing deduplication
        expect(messages.length).toBeGreaterThan(0);
        
        // Check if deduplication marker exists
        const hasDedupMarker = messages.some(msg => msg.message.includes('(x'));
        expect(hasDedupMarker).toBe(true);
    });

    test('should track performance metrics', async () => {
        const log = logger('PerformanceTest', {
            level: 'debug',
            console: false,
            file: false,
            skipCache: true,
            performanceMetrics: true,
            plugins: [{ name: 'Jest', enabled: true, config: {} }],
        });
        
        log.time('test-timer');
        await new Promise(resolve => setTimeout(resolve, 10));
        const duration = log.timeEnd('test-timer');
        
        expect(duration).not.toBeNull();
        expect(duration).toBeGreaterThan(0);
        
        const stats = log.getStats();
        expect(stats.performance).not.toBeNull();
        expect(stats.performance.enabled).toBe(true);
    });

    test('should get statistics', async () => {
        const log = logger('StatsTest', {
            level: 'debug',
            console: false,
            file: false,
            skipCache: true,
            sampling: { debug: 0.5 },
            rateLimit: { error: { max: 5, window: 1000 } },
            plugins: [{ name: 'Jest', enabled: true, config: {} }],
        });
        
        log.debug('Debug message');
        log.error('Error message');
        
        await new Promise(resolve => setImmediate(resolve));
        
        const stats = log.getStats();
        expect(stats.sampling).not.toBeNull();
        expect(stats.sampling.total.debug).toBeGreaterThan(0);
    });
});

