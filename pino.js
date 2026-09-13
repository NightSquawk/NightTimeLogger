'use strict';

/**
 * @file pino.js
 * @description Entry point for `require('ntlogger/pino')`.
 *
 * Exports (in addition to everything `transports/pino.js` exports):
 *   - createLogger(opts)          pre-configured Pino logger with NTL conventions
 *   - isSilent(opts)              silent-mode resolution, exported for testability
 *   - installProcessHandlers()    re-export of lib/processHandlers.js
 *   - drainLogger()               re-export of lib/processHandlers.js
 *
 * The default export is the transport factory itself, so
 * `transport: { target: 'ntlogger/pino' }` keeps working.
 *
 * NOTE: lib/processHandlers.js is required here and *never* from
 * transports/pino.js — the transport runs inside Pino's worker thread, where
 * installing process handlers would be meaningless and harmful.
 */

// Re-export the transport for use with Pino's transport option
// Usage: transport: { target: 'ntlogger/pino' }
module.exports = require('./transports/pino');

const { installProcessHandlers, drainLogger } = require('./lib/processHandlers');

module.exports.installProcessHandlers = installProcessHandlers;
module.exports.drainLogger = drainLogger;

/** Values of NTLOGGER_SILENT that force silent mode on/off. */
const SILENT_TRUE = new Set(['1', 'true', 'yes']);
const SILENT_FALSE = new Set(['0', 'false', 'no']);

/** Pino's default error key. A merge object's `err` supplies `msg` when none is given. */
const ERROR_KEY = 'err';

/** Default budget for `logger.close()`. */
const DEFAULT_CLOSE_TIMEOUT = 5000;

/** A string is treated as a Pino (fast-redact) path when it contains any of these. */
const PINO_PATH_CHARS = /[.[\]*]/;

let contextWarned = false;

/**
 * Emit at most one process warning when a user-supplied context provider throws.
 * @param {Error} err - The swallowed error.
 * @returns {void}
 */
function warnContextOnce(err) {
  if (contextWarned) return;
  contextWarned = true;
  try {
    process.emitWarning(
      'contextProvider threw, context dropped for this and future failures: ' + ((err && err.message) || err),
      'NTLoggerContextWarning'
    );
  } catch (_ignored) {
    // Warning is best-effort.
  }
}

/**
 * Plain object / array test. Used to decide whether an interpolation argument
 * is worth deep-redacting (Errors and class instances are left alone so their
 * `util.format` rendering is unchanged).
 * @param {*} value - Candidate value.
 * @returns {boolean} - True for array literals and plain objects.
 */
function isPlainContainer(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Resolve silent mode.
 *
 * Precedence:
 *   1. `opts.silent` when it is a boolean
 *   2. `NTLOGGER_SILENT` env var (`1|true|yes` / `0|false|no`, case-insensitive)
 *   3. `NODE_ENV === 'test'` or a nonempty `NODE_TEST_CONTEXT`
 *
 * Anything else (unset, or an unrecognised env value) falls through to the next step.
 *
 * @param {object} [opts] - createLogger options.
 * @returns {boolean} - True when the logger must emit nothing.
 */
function isSilent(opts = {}) {
  if (typeof opts.silent === 'boolean') return opts.silent;

  const raw = process.env.NTLOGGER_SILENT;
  if (typeof raw === 'string' && raw.length > 0) {
    const value = raw.trim().toLowerCase();
    if (SILENT_TRUE.has(value)) return true;
    if (SILENT_FALSE.has(value)) return false;
  }

  return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
}

/**
 * Normalize `opts.redact` into a local redactor plus (optionally) paths that are
 * forwarded to Pino's own `redact` option.
 *
 * Accepted shapes:
 *   false      -> redaction disabled entirely
 *   undefined  -> defaults from lib/secretRedaction.js
 *   string[]   -> entries containing `.`/`[`/`]`/`*` become Pino redact paths,
 *                 the rest become `extraKeys` for the local redactor
 *   object     -> passed straight to createRedactor()
 *
 * @param {*} redact - Raw option value.
 * @returns {{redactor: (object|null), paths: (string[]|null)}} - Resolved redaction.
 */
function resolveRedaction(redact) {
  if (redact === false) return { redactor: null, paths: null };

  const { createRedactor } = require('./lib/secretRedaction');

  if (Array.isArray(redact)) {
    const paths = [];
    const extraKeys = [];
    for (const entry of redact) {
      if (typeof entry !== 'string' || entry.length === 0) continue;
      if (PINO_PATH_CHARS.test(entry)) paths.push(entry);
      else extraKeys.push(entry);
    }
    return {
      redactor: createRedactor(extraKeys.length > 0 ? { extraKeys } : undefined),
      paths: paths.length > 0 ? paths : null,
    };
  }

  if (redact !== null && typeof redact === 'object') {
    return { redactor: createRedactor(redact), paths: null };
  }

  return { redactor: createRedactor(), paths: null };
}

/**
 * Redact the free-form string parts of a log call, in place.
 *
 * `formatters.log` only sees the merged object, never the message string or its
 * interpolation arguments, so those have to be handled in the `logMethod` hook.
 * Pino builds a fresh array for every call, so mutating `args` is safe.
 *
 * Two cases need an explicit message to be *inserted*: `log.error(err)` and
 * `log.error({ err })` both take `msg` from `err.message`, which bypasses
 * `formatters.log`. Inserting is skipped when redaction is a no-op so ordinary
 * calls keep their exact original shape.
 *
 * @param {Array} args - Arguments Pino passed to `hooks.logMethod`.
 * @param {object} redactor - Redactor from lib/secretRedaction.js.
 * @returns {Array} - The same array, redacted.
 */
function redactLogArgs(args, redactor) {
  if (!args || args.length === 0) return args;

  const first = args[0];
  let start = 0;

  if (first instanceof Error) {
    start = 1;
    if (typeof args[1] !== 'string' && typeof first.message === 'string') {
      const redacted = redactor.redactString(first.message);
      if (redacted !== first.message) args.splice(1, 0, redacted);
    }
  } else if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
    // Merge object: its own keys are handled by formatters.log.
    start = 1;
    if (typeof args[1] !== 'string'
      && first.msg === undefined
      && first[ERROR_KEY] instanceof Error
      && typeof first[ERROR_KEY].message === 'string') {
      const redacted = redactor.redactString(first[ERROR_KEY].message);
      if (redacted !== first[ERROR_KEY].message) args.splice(1, 0, redacted);
    }
  }

  for (let i = start; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg === 'string') args[i] = redactor.redactString(arg);
    else if (isPlainContainer(arg)) args[i] = redactor.redactObject(arg);
  }

  return args;
}

/**
 * Redact a merge object for `formatters.log`.
 *
 * `formatters.log` runs *before* Pino's serializers (see `_asJson` in
 * pino/lib/tools.js), so a real `Error` under the error key must survive this
 * pass untouched — otherwise Pino's `err` serializer receives a plain object
 * and reports `"type":"Object"`. The error itself is redacted by the `err`
 * serializer installed alongside this formatter.
 *
 * Errors under any *other* key are still deep-redacted here, which is strictly
 * better than Pino's default (`JSON.stringify(new Error())` is `{}`).
 *
 * @param {object} obj - Merged log object.
 * @param {object} redactor - Redactor from lib/secretRedaction.js.
 * @returns {object} - Redacted copy.
 */
function redactMergeObject(obj, redactor) {
  if (obj === null || typeof obj !== 'object' || !(obj[ERROR_KEY] instanceof Error)) {
    return redactor.redactObject(obj);
  }

  const keys = Object.keys(obj);
  const stripped = {};
  for (const key of keys) {
    if (key !== ERROR_KEY) stripped[key] = obj[key];
  }

  const redacted = redactor.redactObject(stripped);
  const out = {};
  for (const key of keys) {
    out[key] = key === ERROR_KEY ? obj[key] : redacted[key];
  }
  return out;
}

/**
 * Build the single `hooks.logMethod` Pino allows, composing string redaction
 * with the sampling/rate-limit/dedup pipeline from lib/pinoHooks.js.
 *
 * @param {object|null} redactor - Redactor, or null when redaction is off.
 * @param {object|null} features - Feature adapter, or null when nothing is configured.
 * @returns {function|null} - Hook function, or null when neither is active.
 */
function composeLogMethod(redactor, features) {
  const featureLog = features && features.enabled ? features.logMethod : null;
  if (!redactor && !featureLog) return null;

  return function logMethod(args, method, level) {
    if (redactor) redactLogArgs(args, redactor);
    if (featureLog) return featureLog.call(this, args, method, level);
    return method.apply(this, args);
  };
}

/**
 * Attach ntlogger's additive API to a Pino logger.
 *
 * Everything is defined as a *non-enumerable own property* of the returned
 * instance. Pino's `child()` does `Object.create(parent)`, so children inherit
 * these through the prototype chain without anything being written to Pino's
 * shared prototype (which would leak across unrelated Pino instances).
 *
 * `child()` itself is overridden so child bindings are redacted: Pino resets
 * `formatters.bindings` to the identity function inside `child()`, so that
 * formatter only ever sees `base`.
 *
 * @param {object} logger - Pino logger instance.
 * @param {object|null} features - Feature adapter from lib/pinoHooks.js.
 * @param {object|null} redactor - Redactor from lib/secretRedaction.js.
 * @param {object} observer - Emitted-record observer and counters.
 * @returns {object} - Pino logger proxy enforcing lifecycle across level changes.
 */
function decorateLogger(logger, features, redactor, observer) {
  const states = new WeakMap();
  const define = (name, value) => Object.defineProperty(logger, name, {
    value, writable: true, configurable: true, enumerable: false,
  });
  define('getStats', () => ({
    ...(features ? features.getStats() : { sampling: null, deduplication: null }),
    ...observer.stats(),
  }));
  define('resetStats', () => { if (features) features.resetStats(); observer.reset(); });
  define('close', function close(timeout = DEFAULT_CLOSE_TIMEOUT) {
    const state = states.get(this);
    if (state.promise) return state.promise;
    state.closed = true;
    if (!state.parent && features) features.destroy();
    state.promise = (async () => {
      const start = Date.now();
      const result = await drainLogger(this, timeout);
      try { await observer.flush(Math.max(1, timeout - (Date.now() - start))); }
      catch (error) { return { drained: false, error }; }
      return result;
    })();
    return state.promise;
  });
  const baseChild = logger.child;
  define('child', function child(bindings, options) {
    const safe = redactor && bindings && typeof bindings === 'object'
      ? redactor.redactObject(bindings) : bindings;
    return wrap(baseChild.call(this, safe, options), states.get(this));
  });
  function wrap(target, parent = null) {
    const state = { closed: false, parent, promise: null };
    states.set(target, state);
    const assertOpen = () => {
      for (let current = state; current; current = current.parent) {
        if (current.closed) throw new Error('Logger is closed');
      }
    };
    const cache = new Map();
    return new Proxy(target, {
      get(raw, key) {
        const value = Reflect.get(raw, key, raw);
        if (typeof value !== 'function') return value;
        const guarded = key === 'child' || key === 'silent' || Object.hasOwn(raw.levels.values, key);
        // Pino regenerates methods on level changes. Cache only while unchanged.
        if (cache.get(key)?.original === value) return cache.get(key).bound;
        const bound = (...args) => { if (guarded) assertOpen(); return value.apply(raw, args); };
        cache.set(key, { original: value, bound });
        return bound;
      },
    });
  }
  return wrap(logger);
}

/**
 * Create a pre-configured Pino logger that follows NightTimeLogger conventions.
 *
 * Returns a *real* Pino logger, so the call signature is object-first:
 * `log.info({ tenantId }, 'message')`.
 *
 * @param {object} [opts] - Options.
 * @param {string} [opts.level] - Pino level. Defaults to `LOG_LEVEL`, else `debug` in dev / `info` in production.
 * @param {string} [opts.module] - Module label added to every line and used as the transport's default label.
 * @param {string} [opts.defaultModule] - Transport label fallback when `module` is not set.
 * @param {boolean} [opts.colorize] - Forwarded to the NTL transport.
 * @param {string} [opts.service] - Constant top-level `service` field (log-contract core field).
 * @param {object} [opts.context] - Static top-level fields merged into every line.
 * @param {function} [opts.contextProvider] - Called per log call; its object result is merged at top level.
 * @param {string[]} [opts.contextKeys] - When set, only these keys are taken from the provider result.
 * @param {false|string[]|object} [opts.redact] - Secret redaction. Defaults to on.
 * @param {object} [opts.sampling] - Per-level sampling rates.
 * @param {object} [opts.rateLimit] - Per-level rate limits.
 * @param {object|boolean} [opts.deduplication] - Duplicate-message collapsing.
 * @param {boolean} [opts.silent] - Force silent mode on/off (see isSilent()).
 * @param {boolean|object} [opts.processHandlers] - Opt-in crash/signal handlers.
 * @param {*} [opts.destination] - For tests/advanced use: a Pino destination stream. Replaces the NTL transport.
 * @returns {object} - Pino logger with `getStats()`, `resetStats()`, `close()` and (optionally) `uninstallProcessHandlers`.
 */
function buildPinoOptions(opts = {}) {
  const pino = require('pino');
  const os = require('os');

  const silent = isSilent(opts);
  const isDev = process.env.NODE_ENV !== 'production';
  const level = silent
    ? 'silent'
    : (opts.level || process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'));

  const observer = require('./lib/logObserver').createLogObserver(opts);
  const loggerOpts = { level, hooks: { streamWrite: observer.streamWrite } };

  // --- constant fields ---------------------------------------------------
  if (typeof opts.service === 'string' && opts.service.length > 0) {
    // `base` replaces Pino's default, so pid/hostname have to be restored.
    loggerOpts.base = { pid: process.pid, hostname: os.hostname(), service: opts.service };
  }

  // --- redaction / features (skipped entirely in silent mode) ------------
  let redactor = null;
  let features = null;
  const secretScope = require('./lib/secretScope');
  loggerOpts.hooks.streamWrite = line => {
    // Interpolation can stringify Errors/Buffers after logMethod has run. Scrub
    // final string fields while a secret scope is active, before observers see them.
    if (redactor && secretScope.hasSecretValues()) {
      line = JSON.stringify(redactor.redactObject(JSON.parse(line))) + '\n';
    }
    return observer.streamWrite(line);
  };

  if (!silent) {
    const redaction = resolveRedaction(opts.redact);
    redactor = redaction.redactor;
    if (redaction.paths) loggerOpts.redact = redaction.paths;

    if (redactor) {
      loggerOpts.formatters = {
        log: obj => redactMergeObject(obj, redactor),
        // Only ever sees `base`: Pino resets this formatter to the identity
        // function inside child(). Child bindings are handled by the child()
        // override in decorateLogger().
        bindings: bindings => redactor.redactObject(bindings),
      };
      // Runs after formatters.log, on the untouched Error, so `type`/`stack`
      // keep Pino's exact shape while their strings get scrubbed.
      loggerOpts.serializers = {
        err: value => (value instanceof Error
          ? redactor.redactObject(pino.stdSerializers.err(value))
          : value),
      };
    }

    const { createPinoFeatures } = require('./lib/pinoHooks');
    features = createPinoFeatures({
      sampling: opts.sampling,
      rateLimit: opts.rateLimit,
      deduplication: opts.deduplication,
      defaultLocation: opts.module || opts.defaultModule,
    });

    const logMethod = composeLogMethod(redactor, features);
    if (logMethod) loggerOpts.hooks.logMethod = logMethod;
  }

  // --- context mixin ------------------------------------------------------
  const staticContext = opts.context !== null && typeof opts.context === 'object' && !Array.isArray(opts.context)
    ? Object.assign({}, opts.context)
    : null;
  const provider = typeof opts.contextProvider === 'function' ? opts.contextProvider : null;
  const contextKeys = Array.isArray(opts.contextKeys) && opts.contextKeys.length > 0
    ? opts.contextKeys.slice()
    : null;

  if (!silent && (opts.module || staticContext || provider || opts.otel)) {
    // Precedence, lowest to highest: base/service < module < context < contextProvider
    // < fields passed on the log call itself (Pino's default mixin merge strategy
    // assigns the merge object over the mixin output).
    loggerOpts.mixin = () => {
      const out = {};
      if (opts.module) out.module = opts.module;
      if (staticContext) Object.assign(out, staticContext);

      if (provider) {
        let dynamic;
        try {
          dynamic = provider();
        } catch (err) {
          warnContextOnce(err);
          dynamic = null;
        }
        if (dynamic !== null && typeof dynamic === 'object' && !Array.isArray(dynamic)) {
          if (contextKeys) {
            for (const key of contextKeys) {
              const value = dynamic[key];
              if (value !== undefined) out[key] = value;
            }
          } else {
            Object.assign(out, dynamic);
          }
        }
      }

      return Object.assign(out, observer.context());
    };
  }

  return { loggerOpts, features, redactor, silent, isDev, observer };
}

function createLogger(opts = {}) {
  const pino = require('pino');
  const path = require('path');
  const { loggerOpts, features, redactor, silent, isDev, observer } = buildPinoOptions(opts);

  // --- destination / transport -------------------------------------------
  // `opts.destination` and `transport` are mutually exclusive in Pino, so an
  // explicit destination always wins and the NTL formatter is skipped.
  const destination = opts.destination !== undefined && opts.destination !== null ? opts.destination : null;

  if (!silent && !destination && isDev) {
    loggerOpts.transport = {
      target: path.join(__dirname, 'transports', 'pino.js'),
      options: {
        defaultModule: opts.module || opts.defaultModule,
        colorize: opts.colorize,
      },
    };
  }

  const logger = decorateLogger(destination ? pino(loggerOpts, destination) : pino(loggerOpts), features, redactor, observer);

  if (opts.processHandlers) {
    const handlerOpts = typeof opts.processHandlers === 'object' ? opts.processHandlers : {};
    Object.defineProperty(logger, 'uninstallProcessHandlers', {
      value: installProcessHandlers(logger, handlerOpts),
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  return logger;
}

module.exports.createLogger = createLogger;
module.exports.isSilent = isSilent;

/**
 * Plain Pino options for framework-owned loggers. No transport, process
 * handlers, or feature timers are created; the framework owns the lifecycle.
 * Supply custom serializers here so their output is redacted too.
 */
function createPinoOptions(opts = {}) {
  for (const key of ['sampling', 'rateLimit', 'deduplication', 'destination', 'processHandlers']) {
    if (opts[key] !== undefined) {
      throw new TypeError(`createPinoOptions does not support ${key}; use createLogger instead`);
    }
  }
  const pino = require('pino');
  const { loggerOpts, redactor } = buildPinoOptions(opts);
  const serializers = {
    req: req => ({
      method: req.method,
      url: req.url,
      version: req.headers && req.headers['accept-version'],
      host: req.host,
      remoteAddress: req.ip || (req.socket && req.socket.remoteAddress),
      remotePort: req.socket && req.socket.remotePort,
    }),
    res: res => ({ statusCode: res.statusCode }),
    err: pino.stdSerializers.err,
    ...opts.serializers,
  };
  loggerOpts.serializers = {};
  for (const [key, serialize] of Object.entries(serializers)) {
    if (typeof serialize !== 'function') throw new TypeError(`Invalid serializer: ${key}`);
    loggerOpts.serializers[key] = redactor
      ? value => redactor.redactObject(serialize(value))
      : serialize;
  }
  if (redactor) {
    // Pino invokes formatters before serializers. Preserve their input objects
    // (including prototypes/getters) and redact the serialized output instead.
    loggerOpts.formatters.log = obj => {
      const plain = {};
      for (const key of Object.keys(obj)) {
        if (!Object.hasOwn(serializers, key)) plain[key] = obj[key];
      }
      const safe = redactor.redactObject(plain);
      for (const key of Object.keys(obj)) {
        if (Object.hasOwn(serializers, key)) safe[key] = obj[key];
      }
      return safe;
    };
  }
  return loggerOpts;
}

/** Capture the actual JSON records without a console or worker transport. */
function createTestLogger(opts = {}) {
  const records = [];
  const logger = createLogger({
    ...opts,
    silent: opts.silent ?? false,
    level: opts.level ?? 'trace',
    destination: { write(line) { records.push(JSON.parse(line)); } },
  });
  return { logger, records };
}

module.exports.createPinoOptions = createPinoOptions;
module.exports.createTestLogger = createTestLogger;

module.exports.withSecretValues = require('./lib/secretScope').withSecretValues;
