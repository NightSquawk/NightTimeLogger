/**
 * @file /lib/performanceTracker.js
 * @description Tracks performance metrics for development mode.
 */

/**
 * Performance tracker class
 */
class PerformanceTracker {
    constructor(enabled = false) {
        this.enabled = enabled;
        this.timers = new WeakMap(); // Use WeakMap to avoid memory leaks
        this.timerData = new Map(); // Store timer data with labels as keys
        this.stats = {
            logProcessingTime: [],
            transportTime: [],
        };
    }

    /**
     * Start a timer
     * @param {string} label - Timer label
     */
    time(label) {
        if (!this.enabled) return;
        this.timerData.set(label, performance.now());
    }

    /**
     * End a timer and return duration
     * @param {string} label - Timer label
     * @returns {number|null} - Duration in milliseconds or null if timer not found
     */
    timeEnd(label) {
        if (!this.enabled) return null;
        const start = this.timerData.get(label);
        if (start === undefined) {
            return null;
        }
        const duration = performance.now() - start;
        this.timerData.delete(label);
        return duration;
    }

    /**
     * Record log processing time
     * @param {number} duration - Duration in milliseconds
     */
    recordLogProcessing(duration) {
        if (!this.enabled) return;
        this.stats.logProcessingTime.push(duration);
        // Keep only last 100 entries
        if (this.stats.logProcessingTime.length > 100) {
            this.stats.logProcessingTime.shift();
        }
    }

    /**
     * Record transport execution time
     * @param {number} duration - Duration in milliseconds
     */
    recordTransport(duration) {
        if (!this.enabled) return;
        this.stats.transportTime.push(duration);
        // Keep only last 100 entries
        if (this.stats.transportTime.length > 100) {
            this.stats.transportTime.shift();
        }
    }

    /**
     * Get statistics
     * @returns {object} - Statistics object
     */
    getStats() {
        if (!this.enabled) {
            return { enabled: false };
        }

        const avgLogProcessing = this.stats.logProcessingTime.length > 0
            ? this.stats.logProcessingTime.reduce((a, b) => a + b, 0) / this.stats.logProcessingTime.length
            : 0;

        const avgTransport = this.stats.transportTime.length > 0
            ? this.stats.transportTime.reduce((a, b) => a + b, 0) / this.stats.transportTime.length
            : 0;

        return {
            enabled: true,
            avgLogProcessingTime: avgLogProcessing,
            avgTransportTime: avgTransport,
            logProcessingSamples: this.stats.logProcessingTime.length,
            transportSamples: this.stats.transportTime.length,
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            logProcessingTime: [],
            transportTime: [],
        };
        this.timerData.clear();
    }
}

module.exports = {
    PerformanceTracker,
};

