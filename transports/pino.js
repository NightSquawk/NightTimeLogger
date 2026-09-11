'use strict';

const split = require('split2');
const { isMainThread } = require('worker_threads');
const fs = require('fs');

function writeOutput(line) {
  if (isMainThread) return process.stdout.write(line);
  // ThreadStream.end() can block the parent on Atomics.wait. Worker stdout
  // callbacks need that parent's event loop, so write to the fd directly.
  const bytes = Buffer.from(line);
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(1, bytes, offset, bytes.length - offset);
}
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
 * Structured context fields rendered as a compact `{k=v ...}` suffix right
 * after the module label. Order here is the render order.
 */
const CONTEXT_KEYS = [
  'tenantId',
  'userId',
  'correlationId',
  'traceId',
  'spanId',
  'jobId',
  'agentUuid',
  'commandId',
];

/**
 * Boilerplate messages emitted by pino-http/Fastify for the request-start
 * line. They carry no information once the method and URL are rendered.
 */
const GENERIC_REQUEST_MESSAGES = new Set(['incoming request', 'request received']);

// Defaults for the in-flight request map. Both are overridable per transport.
const DEFAULT_MAX_INFLIGHT_REQUESTS = 1000;
const DEFAULT_INFLIGHT_TTL_MS = 60000;

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
 * Bounded map of in-flight HTTP requests.
 *
 * pino-http/Fastify split a request across two lines: the request-start line
 * carries `req.method` / `req.url`, the completion line carries only
 * `res.statusCode` and `responseTime`. Remembering the start line lets the
 * completion line render `METHOD /path — STATUS (Nms)`.
 *
 * A request that never completes (aborted socket, crashed handler) would leak
 * an entry forever, so entries expire by age and the map is capped. Both
 * sweeps are lazy — no timers, nothing that can keep a process alive.
 *
 * @param {Object} opts
 * @param {number} [opts.maxInflightRequests=1000] Hard cap on tracked requests.
 * @param {number} [opts.inflightTtlMs=60000] Max age of a tracked request.
 */
function createRequestTracker(opts = {}) {
  const max = Number.isFinite(opts.maxInflightRequests) && opts.maxInflightRequests > 0
    ? Math.floor(opts.maxInflightRequests)
    : DEFAULT_MAX_INFLIGHT_REQUESTS;
  const ttl = Number.isFinite(opts.inflightTtlMs) && opts.inflightTtlMs > 0
    ? opts.inflightTtlMs
    : DEFAULT_INFLIGHT_TTL_MS;

  // Map preserves insertion order, and entries are always (re)inserted at the
  // tail, so the head is always the oldest entry.
  const entries = new Map();

  function prune(now = Date.now()) {
    for (const [key, value] of entries) {
      if (now - value.at < ttl) break;
      entries.delete(key);
    }
    while (entries.size > max) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  return {
    /**
     * Remember an in-flight request. Re-tracking an id refreshes its position.
     */
    track(id, method, url, now = Date.now()) {
      if (!id) return;
      if (entries.has(id)) entries.delete(id);
      entries.set(id, { method: method || '', url: url || '', at: now });
      prune(now);
    },
    /**
     * Look up and forget a tracked request.
     * @returns {{method: string, url: string}|null}
     */
    take(id) {
      if (!id) return null;
      const entry = entries.get(id);
      if (!entry) return null;
      entries.delete(id);
      return { method: entry.method, url: entry.url };
    },
    prune,
    get size() {
      return entries.size;
    },
    get maxInflightRequests() {
      return max;
    },
    get inflightTtlMs() {
      return ttl;
    },
  };
}

/**
 * Render the structured context suffix, e.g. `{tenantId=t1 correlationId=c9}`.
 * Only keys that are actually present (and non-empty) are rendered.
 *
 * @returns {string} Dim-wrapped suffix, or '' when no context keys are present.
 */
function formatContext(obj) {
  const pairs = [];
  for (const key of CONTEXT_KEYS) {
    const value = obj[key];
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }
  if (pairs.length === 0) return '';
  return `${DIM}{${pairs.join(' ')}}${RESET}`;
}

/**
 * Format a single Pino log object into an NTL-style string.
 *
 * @param {Object} obj - Pino JSON log object
 * @param {Object} opts - Transport options
 * @param {Object} [tracker] - Optional in-flight request tracker (see
 *   createRequestTracker). When omitted, request/response pairing is skipped
 *   and only inline `req` data is used.
 * @returns {string} Formatted log line
 */
function formatLine(obj, opts = {}, tracker = null) {
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

  // 5. Structured context — {tenantId=… correlationId=…}
  const context = formatContext(obj);
  if (context) {
    parts.push(context);
  }

  // 6. Message
  let msg = obj.msg || obj.message || '';

  if (obj.req && !obj.res) {
    // Request start — remember it so the completion line can name the route.
    const method = (obj.req.method) || '';
    const url = (obj.req.url) || '';
    if (tracker && (method || url)) {
      tracker.track(id, method, url);
    }
    if (method && url) {
      msg = GENERIC_REQUEST_MESSAGES.has(msg) || !msg
        ? `${method} ${url}`
        : `${method} ${url} ${GREY}—${RESET} ${msg}`;
    }
  } else if (obj.res && obj.responseTime !== undefined) {
    // 7. HTTP request completion — format as: METHOD /path — STATUS (TIMEms)
    const status = obj.res.statusCode;
    const statusGroup = Math.floor(status / 100);
    const statusColor = STATUS_COLORS[statusGroup] || '';
    const time = typeof obj.responseTime === 'number'
      ? obj.responseTime.toFixed(1)
      : obj.responseTime;

    // Inline req wins; otherwise fall back to the tracked request-start line.
    let method = (obj.req && obj.req.method) || '';
    let url = (obj.req && obj.req.url) || '';
    const tracked = tracker ? tracker.take(id) : null;
    if (!(method && url) && tracked) {
      method = tracked.method;
      url = tracked.url;
    }

    if (method && url) {
      msg = `${method} ${url} — ${statusColor}${status}${RESET} ${GREY}(${time}ms)${RESET}`;
    } else if (msg) {
      msg = `${msg} — ${statusColor}${status}${RESET} ${GREY}(${time}ms)${RESET}`;
    } else {
      msg = `${statusColor}${status}${RESET} ${GREY}(${time}ms)${RESET}`;
    }
  }

  // 8. Error stack traces
  if (obj.err) {
    const stack = obj.err.stack || obj.err.message || '';
    if (stack) {
      msg += `\n${levelInfo.color}${stack}${RESET}`;
    }
  }

  parts.push(msg);

  const line = parts.join(' ');
  return opts.colorize === false ? line.replace(/\x1b\[[0-9;]*m/g, '') : line;
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
 *   - colorize: Set to false to strip all ANSI codes from the output
 *   - maxInflightRequests: Cap on remembered in-flight requests (default 1000)
 *   - inflightTtlMs: Max age of a remembered in-flight request (default 60000)
 *
 * @param {Object} opts - Transport options
 */
module.exports = function (opts = {}) {
  const tracker = createRequestTracker(opts);

  const stream = split(function (line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      writeOutput(line + '\n');
      return;
    }
    const formatted = formatLine(obj, opts, tracker);
    writeOutput(formatted + '\n');
  });
  // The worker consumes only the writable side; drain the readable side so
  // split2 can emit end/close and let Pino terminate its worker.
  const flush = stream._flush.bind(stream);
  stream._flush = callback => flush(error => {
    if (error) return callback(error);
    // stdout is asynchronous in a Pino worker. Wait for preceding writes before
    // signalling completion, otherwise worker shutdown can discard the output.
    if (isMainThread) process.stdout.write('', callback);
    else callback();
  });
  stream.resume();
  return stream;
};

// Export internals for testing
module.exports.formatLine = formatLine;
module.exports.formatTimestamp = formatTimestamp;
module.exports.padLevel = padLevel;
module.exports.formatContext = formatContext;
module.exports.createRequestTracker = createRequestTracker;
module.exports.CONTEXT_KEYS = CONTEXT_KEYS;
