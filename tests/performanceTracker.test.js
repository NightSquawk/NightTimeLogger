/**
 * @file /tests/performanceTracker.test.js
 * @description Tests for performanceTracker module
 */

const { PerformanceTracker } = require('../lib/performanceTracker');

describe('PerformanceTracker Tests', () => {
    test('should not track when disabled', () => {
        const tracker = new PerformanceTracker(false);
        tracker.time('test');
        const duration = tracker.timeEnd('test');
        expect(duration).toBeNull();
        
        tracker.recordLogProcessing(10);
        const stats = tracker.getStats();
        expect(stats.enabled).toBe(false);
    });

    test('should track time and timeEnd', () => {
        const tracker = new PerformanceTracker(true);
        
        tracker.time('test-timer');
        const duration = tracker.timeEnd('test-timer');
        
        expect(duration).not.toBeNull();
        expect(typeof duration).toBe('number');
        expect(duration).toBeGreaterThanOrEqual(0);
    });

    test('should return null for non-existent timer', () => {
        const tracker = new PerformanceTracker(true);
        const duration = tracker.timeEnd('non-existent');
        expect(duration).toBeNull();
    });

    test('should record log processing time', () => {
        const tracker = new PerformanceTracker(true);
        
        tracker.recordLogProcessing(10.5);
        tracker.recordLogProcessing(20.3);
        
        const stats = tracker.getStats();
        expect(stats.enabled).toBe(true);
        expect(stats.logProcessingSamples).toBe(2);
        expect(stats.avgLogProcessingTime).toBeCloseTo(15.4, 1);
    });

    test('should record transport time', () => {
        const tracker = new PerformanceTracker(true);
        
        tracker.recordTransport(5.2);
        tracker.recordTransport(8.7);
        
        const stats = tracker.getStats();
        expect(stats.transportSamples).toBe(2);
        expect(stats.avgTransportTime).toBeCloseTo(6.95, 1);
    });

    test('should limit samples to 100', () => {
        const tracker = new PerformanceTracker(true);
        
        for (let i = 0; i < 150; i++) {
            tracker.recordLogProcessing(i);
        }
        
        const stats = tracker.getStats();
        expect(stats.logProcessingSamples).toBe(100);
    });

    test('should reset statistics', () => {
        const tracker = new PerformanceTracker(true);
        
        tracker.recordLogProcessing(10);
        tracker.time('test');
        tracker.timeEnd('test');
        
        tracker.resetStats();
        
        const stats = tracker.getStats();
        expect(stats.logProcessingSamples).toBe(0);
        expect(stats.transportSamples).toBe(0);
    });
});

