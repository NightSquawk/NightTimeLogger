/**
 * @file /lib/messageNormalizer.js
 * @description Normalizes log messages by replacing dynamic values with placeholders for deduplication.
 */

/**
 * Normalizes a message by replacing dynamic values (UUIDs, IDs, numbers) with placeholders
 * @param {string} message - The message to normalize
 * @returns {string} - Normalized message with placeholders
 */
function normalizeMessage(message) {
    if (typeof message !== 'string') {
        return String(message);
    }

    // Replace UUIDs (e.g., a481199f-ed1c-47c6-834d-9cf54cdc394e)
    let normalized = message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '*');

    // Replace long hex strings (32+ chars)
    normalized = normalized.replace(/[0-9a-f]{32,}/gi, '*');

    // Replace numbers that appear to be IDs (standalone numbers, especially in phrases like "device 1234")
    normalized = normalized.replace(/\b(?:device|id|threshold|ticket|job|request|user|session)\s+(\d+)\b/gi, (match, num) => {
        return match.replace(num, '*');
    });

    // Replace standalone large numbers (likely IDs) - but keep small numbers (like counts, percentages)
    normalized = normalized.replace(/\b(\d{4,})\b/g, '*');

    // Replace timestamps (numbers with dashes or colons)
    normalized = normalized.replace(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/g, '*');

    return normalized;
}

module.exports = {
    normalizeMessage,
};

