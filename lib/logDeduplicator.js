/**
 * @file /lib/logDeduplicator.js
 * @description Handles log deduplication/squishing by grouping similar messages.
 */

const crypto = require('crypto');
const { normalizeMessage } = require('./messageNormalizer');

/**
 * Creates a fingerprint for a log message
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {string} location - Logger location
 * @param {string} filePath - File path (if available)
 * @returns {string} - Message fingerprint
 */
function createFingerprint(level, message, location, filePath) {
    const normalized = normalizeMessage(message);
    const key = `${level}:${normalized}:${location || ''}:${filePath || ''}`;
    return crypto.createHash('md5').update(key).digest('hex');
}

/**
 * Log deduplicator class
 */
class LogDeduplicator {
    constructor(config = {}) {
        this.enabled = config.enabled || false;
        this.threshold = config.threshold || 3;
        this.window = config.window || 60000; // 60 seconds default
        this.entries = new Map(); // fingerprint -> { count, firstSeen, lastSeen, sample }
        this.stats = {
            totalDeduplicated: 0,
            uniqueMessages: 0,
        };

        // Cleanup old entries periodically
        if (this.enabled) {
            this.cleanupInterval = setInterval(() => this.cleanup(), this.window);
        }
    }

    /**
     * Check if a log should be deduplicated
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {object} meta - Log metadata
     * @returns {object|null} - Returns { shouldLog: boolean, count: number, message: string } or null if not deduplicated
     */
    check(level, message, meta = {}) {
        if (!this.enabled) {
            return null;
        }

        const fingerprint = createFingerprint(level, message, meta.location, meta.filePath);
        const now = Date.now();
        const entry = this.entries.get(fingerprint);

        if (!entry) {
            // First occurrence
            this.entries.set(fingerprint, {
                count: 1,
                firstSeen: now,
                lastSeen: now,
                sample: { level, message, meta },
            });
            this.stats.uniqueMessages++;
            return { shouldLog: true, count: 1, message };
        }

        // Update entry
        entry.count++;
        entry.lastSeen = now;

        if (entry.count < this.threshold) {
            // Still below threshold, log normally
            return { shouldLog: true, count: entry.count, message };
        } else if (entry.count === this.threshold) {
            // Just reached threshold, log with count
            this.stats.totalDeduplicated += entry.count - 1; // Count suppressed logs
            return {
                shouldLog: true,
                count: entry.count,
                message: `${message} (x${entry.count})`,
            };
        } else {
            // Above threshold, suppress but update count
            this.stats.totalDeduplicated++;
            return { shouldLog: false, count: entry.count, message: `${message} (x${entry.count})` };
        }
    }

    /**
     * Clean up old entries
     */
    cleanup() {
        const now = Date.now();
        for (const [fingerprint, entry] of this.entries.entries()) {
            if (now - entry.lastSeen > this.window) {
                this.entries.delete(fingerprint);
            }
        }
    }

    /**
     * Get statistics
     * @returns {object} - Statistics object
     */
    getStats() {
        return {
            ...this.stats,
            activeEntries: this.entries.size,
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalDeduplicated: 0,
            uniqueMessages: 0,
        };
    }

    /**
     * Destroy the deduplicator
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.entries.clear();
    }
}

module.exports = {
    LogDeduplicator,
    createFingerprint,
};

