'use strict';

const split = require('split2');
const colors = require('../lib/colors');

const levelColors = colors.console;

// Utility ANSI codes not exported by lib/colors.js
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREY = '\x1b[90m';
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';

/**
 * Map Pino numeric levels to NTL level names and colors.
 *
 * Pino levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
 * NTL levels:  trace(5), debug(4), info(3), warn(2), error(1), fatal(0)
 *
 * We only need the display names and colors here, not NTL's numeric ordering.
 */
const PINO_LEVEL_MAP = {
  10: { name: 'trace', color: levelColors.trace },
  20: { name: 'debug', color: levelColors.debug },
  30: { name: 'info',  color: levelColors.info },
  40: { name: 'warn',  color: levelColors.warn },
  50: { name: 'error', color: levelColors.error },
  60: { name: 'fatal', color: levelColors.fatal },
};

// Status code colors
const STATUS_COLORS = {
  2: GREEN,
  3: CYAN,
  4: '\x1b[33m',
  5: '\x1b[31m',
};

/**
 * Format a timestamp to YYYY-MM-DD HH:mm:ss (NTL style).
 */
function formatTimestamp(epoch) {
  const d = new Date(epoch);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

/**
 * Pad level name to 8 chars (NTL style: [info    ], [error   ], [warn    ]).
 */
function padLevel(name) {
  return name.padEnd(8);
}

/**
 * Format a single Pino log object into an NTL-style string.
 *
 * @param {Object} obj - Pino JSON log object
 * @param {Object} opts - Transport options
 * @returns {string} Formatted log line
 */
function formatLine(obj, opts = {}) {
  const parts = [];

  // 1. Timestamp
  const ts = formatTimestamp(obj.time);
  parts.push(`${GREY}${ts}${RESET}`);

  // 2. Level — [info    ] padded and colored
  const levelInfo = PINO_LEVEL_MAP[obj.level] || { name: 'unknown', color: '' };
  parts.push(`${levelInfo.color}[${padLevel(levelInfo.name)}]${RESET}`);

  // 3. Request/Session ID — [ID: xxx]
  const id = obj.reqId || obj.requestId || obj.sessionId || null;
  if (id) {
    parts.push(`${MAGENTA}[ID: ${id}]${RESET}`);
  }

  // 4. Location/Module label — [ModuleName]
  const location = obj.module || obj.location || obj.name || opts.defaultModule || null;
  if (location) {
    parts.push(`${GREEN}[${location}]${RESET}:`);
  }

  // 5. Message
  let msg = obj.msg || obj.message || '';

  // 6. HTTP request completion — format as: METHOD /path — STATUS (TIMEms)
  if (obj.res && obj.responseTime !== undefined) {
    const status = obj.res.statusCode;
    const statusGroup = Math.floor(status / 100);
    const statusColor = STATUS_COLORS[statusGroup] || '';
    const method = (obj.req && obj.req.method) || '';
    const url = (obj.req && obj.req.url) || '';
    const time = typeof obj.responseTime === 'number'
      ? obj.responseTime.toFixed(1)
      : obj.responseTime;

    if (method && url) {
      msg = `${method} ${url} — ${statusColor}${status}${RESET} ${GREY}(${time}ms)${RESET}`;
    } else if (msg) {
      msg = `${msg} — ${statusColor}${status}${RESET} ${GREY}(${time}ms)${RESET}`;
    } else {
      msg = `${statusColor}${status}${RESET} ${GREY}(${time}ms)${RESET}`;
    }
  }

  // 7. Error stack traces
  if (obj.err) {
    const stack = obj.err.stack || obj.err.message || '';
    if (stack) {
      msg += `\n${levelInfo.color}${stack}${RESET}`;
    }
  }

  parts.push(msg);

  return parts.join(' ');
}

/**
 * NightTimeLogger Pino Transport.
 *
 * Usage with Fastify:
 *   const app = Fastify({
 *     logger: {
 *       transport: {
 *         target: 'ntlogger/pino',
 *         options: { defaultModule: 'API' }
 *       }
 *     }
 *   });
 *
 * Usage with plain Pino:
 *   const pino = require('pino');
 *   const logger = pino({
 *     transport: {
 *       target: 'ntlogger/pino',
 *       options: { defaultModule: 'MyApp' }
 *     }
 *   });
 *
 * Options:
 *   - defaultModule: Default location label when obj.module is not set (e.g., 'API')
 *
 * @param {Object} opts - Transport options
 */
module.exports = function (opts = {}) {
  return split(function (line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      process.stdout.write(line + '\n');
      return;
    }
    const formatted = formatLine(obj, opts);
    process.stdout.write(formatted + '\n');
  });
};

// Export internals for testing
module.exports.formatLine = formatLine;
module.exports.formatTimestamp = formatTimestamp;
module.exports.padLevel = padLevel;
