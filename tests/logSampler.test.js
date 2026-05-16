/**
 * @file /tests/logSampler.test.js
 * @description Tests for logSampler module
 */

const { LogSampler } = require('../lib/logSampler');

describe('LogSampler Tests', () => {
    test('should process logs when no sampling configured', () => {
        const sampler = new LogSampler({});
        expect(sampler.shouldProcess('info')).toBe(true);
        expect(sampler.shouldProcess('debug')).toBe(true);
    });

    test('should sample debug logs at 50% rate', () => {
        const sampler = new LogSampler({
            sampling: { debug: 0.5 }
        });
        
        let processed = 0;
        let total = 100;
        
        for (let i = 0; i < total; i++) {
            if (sampler.shouldProcess('debug')) {
                processed++;
            }
        }
        
        // Should be approximately 50% (allow some variance)
        expect(processed).toBeGreaterThan(30);
        expect(processed).toBeLessThan(70);
    });

    test('should rate limit errors', () => {
        const sampler = new LogSampler({
            rateLimit: {
                error: { max: 3, window: 1000 }
            }
        });
        
        // First 3 should pass
        expect(sampler.shouldProcess('error')).toBe(true);
        expect(sampler.shouldProcess('error')).toBe(true);
        expect(sampler.shouldProcess('error')).toBe(true);
        
        // Next ones should be rate limited
        expect(sampler.shouldProcess('error')).toBe(false);
        expect(sampler.shouldProcess('error')).toBe(false);
    });

    test('should reset rate limit after window', async () => {
        const sampler = new LogSampler({
            rateLimit: {
                error: { max: 2, window: 100 }
            }
        });
        
        expect(sampler.shouldProcess('error')).toBe(true);
        expect(sampler.shouldProcess('error')).toBe(true);
        expect(sampler.shouldProcess('error')).toBe(false);
        
        // Wait for window to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Should work again
        expect(sampler.shouldProcess('error')).toBe(true);
    });

    test('should get statistics', () => {
        const sampler = new LogSampler({
            sampling: { debug: 0.5 },
            rateLimit: { error: { max: 5, window: 1000 } }
        });
        
        for (let i = 0; i < 10; i++) {
            sampler.shouldProcess('debug');
            sampler.shouldProcess('error');
        }
        
        const stats = sampler.getStats();
        expect(stats.total.debug).toBe(10);
        expect(stats.total.error).toBe(10);
        expect(stats.sampled.debug).toBeGreaterThan(0);
        expect(stats.rateLimited.error).toBeGreaterThan(0);
    });

    test('should destroy and cleanup', () => {
        const sampler = new LogSampler({
            rateLimit: { error: { max: 5, window: 1000 } }
        });

        expect(sampler.cleanupInterval).toBeDefined();
        sampler.destroy();
        expect(sampler.cleanupInterval).toBeNull();
        // Should not throw
        expect(() => sampler.shouldProcess('error')).not.toThrow();
    });

    test('cleanupRateLimits removes expired counters', () => {
        const sampler = new LogSampler({
            rateLimit: { error: { max: 5, window: 10 } }
        });

        sampler.shouldProcess('error');
        expect(sampler.rateLimitCounters.has('error')).toBe(true);

        // Backdate the window to force expiry
        const counter = sampler.rateLimitCounters.get('error');
        counter.windowStart = Date.now() - 1000;

        sampler.cleanupRateLimits();
        expect(sampler.rateLimitCounters.has('error')).toBe(false);

        sampler.destroy();
    });

    test('cleanupRateLimits leaves non-expired counters in place', () => {
        const sampler = new LogSampler({
            rateLimit: { error: { max: 5, window: 60000 } }
        });

        sampler.shouldProcess('error');
        sampler.cleanupRateLimits();
        expect(sampler.rateLimitCounters.has('error')).toBe(true);

        sampler.destroy();
    });

    test('resetStats clears accumulated counters', () => {
        const sampler = new LogSampler({
            rateLimit: { error: { max: 2, window: 1000 } },
            sampling: { debug: 0.0 },
        });

        for (let i = 0; i < 5; i++) {
            sampler.shouldProcess('error');
            sampler.shouldProcess('debug');
        }

        const before = sampler.getStats();
        expect(before.total.error).toBeGreaterThan(0);
        expect(before.total.debug).toBeGreaterThan(0);

        sampler.resetStats();
        const after = sampler.getStats();
        expect(after.total).toEqual({});
        expect(after.sampled).toEqual({});
        expect(after.rateLimited).toEqual({});

        sampler.destroy();
    });
});

