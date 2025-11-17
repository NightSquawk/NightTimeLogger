/**
 * @file /lib/logSampler.js
 * @description Handles log sampling and rate limiting with statistics.
 */

/**
 * Log sampler and rate limiter class
 */
class LogSampler {
    constructor(config = {}) {
        this.sampling = config.sampling || {};
        this.rateLimit = config.rateLimit || {};
        this.stats = {
            total: {},
            sampled: {},
            rateLimited: {},
        };

        // Rate limit tracking: level -> { count: number, windowStart: number }
        this.rateLimitCounters = new Map();

        // Cleanup old rate limit entries periodically
        if (Object.keys(this.rateLimit).length > 0) {
            this.cleanupInterval = setInterval(() => this.cleanupRateLimits(), 60000);
        }
    }

    /**
     * Check if a log should be processed based on sampling and rate limiting
     * @param {string} level - Log level
     * @returns {boolean} - True if log should be processed, false if skipped
     */
    shouldProcess(level) {
        // Initialize stats for level if needed
        if (!this.stats.total[level]) {
            this.stats.total[level] = 0;
            this.stats.sampled[level] = 0;
            this.stats.rateLimited[level] = 0;
        }

        this.stats.total[level]++;

        // Check rate limiting first (more restrictive)
        if (this.rateLimit[level]) {
            const limit = this.rateLimit[level];
            const now = Date.now();
            const key = level;
            const counter = this.rateLimitCounters.get(key);

            if (counter) {
                // Check if we're still in the same window
                if (now - counter.windowStart < limit.window) {
                    if (counter.count >= limit.max) {
                        // Rate limit exceeded
                        this.stats.rateLimited[level]++;
                        return false;
                    }
                    counter.count++;
                } else {
                    // New window
                    this.rateLimitCounters.set(key, { count: 1, windowStart: now });
                }
            } else {
                // First log in this level
                this.rateLimitCounters.set(key, { count: 1, windowStart: now });
            }
        }

        // Check sampling
        if (this.sampling[level] !== undefined) {
            const rate = this.sampling[level];
            if (rate < 1.0 && Math.random() > rate) {
                // Sample rejected
                this.stats.sampled[level]++;
                return false;
            }
        }

        return true;
    }

    /**
     * Clean up old rate limit entries
     */
    cleanupRateLimits() {
        const now = Date.now();
        for (const [level, limit] of Object.entries(this.rateLimit)) {
            const key = level;
            const counter = this.rateLimitCounters.get(key);
            if (counter && now - counter.windowStart >= limit.window) {
                // Entry expired, will be reset on next use
                this.rateLimitCounters.delete(key);
            }
        }
    }

    /**
     * Get statistics
     * @returns {object} - Statistics object
     */
    getStats() {
        return {
            total: { ...this.stats.total },
            sampled: { ...this.stats.sampled },
            rateLimited: { ...this.stats.rateLimited },
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            total: {},
            sampled: {},
            rateLimited: {},
        };
    }

    /**
     * Destroy the sampler
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.rateLimitCounters.clear();
    }
}

module.exports = {
    LogSampler,
};

