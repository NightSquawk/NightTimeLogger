# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NightTimeLogger (`ntlogger`) is a Winston-based logging wrapper for Node.js providing custom log levels, a plugin architecture, child loggers, log sampling/rate-limiting/deduplication, call site reporting, and performance metrics. Published to npm as `ntlogger`. Pure CommonJS, no build step.

## Commands

```bash
npm test                                        # Run all tests
npm test -- --testPathPattern=base.test.js      # Run a single test file
npm test -- --coverage                          # Run with coverage
```

No build, lint, or compile steps — this is a plain JS library.

## Architecture

**Entry point:** `index.js` → re-exports `lib/logger.js`

**Core flow:** `lib/logger.js` creates Winston logger instances with non-blocking wrappers (`setImmediate`) around each log method. Features (sampling, dedup, path reporting) are applied inside the async callback, not synchronously.

**Module dependency graph:**
```
lib/logger.js (core — instance cache, color generation, method wrapping)
├── lib/levels.js          — 7 custom levels: fatal(0) → internal(6)
├── lib/colors.js          — ANSI + Discord color codes
├── lib/logSampler.js      — per-level sampling rates + rate limiting
├── lib/logDeduplicator.js — groups duplicate messages with "(xN)" suffix
│   └── lib/messageNormalizer.js
├── lib/pathReporter.js    — call site from stack trace (file:line:col [fn chain])
├── lib/performanceTracker.js — dev-mode timing metrics (WeakMap-based)
├── lib/signalHandler.js   — SIGINT/SIGTERM graceful shutdown
└── plugins/index.js       — plugin loader (try/catch per plugin, graceful degradation)
    └── plugins/{sentry,mysql,postgres,jest,discord,teams,syslog,openobserve}.js
```

**Plugin system:** Each plugin exports a `transport` class extending `winston-transport`. Configured via `plugins: [{name, enabled, config}]`. Failed plugins are logged and skipped, never crash the logger.

**Logger caching:** Instances are cached by location name in a Map. Same location + same config returns cached instance. `skipCache: true` forces a new instance. Child loggers always skip cache. Exception: if the cached instance lacks advanced features (sampling / rateLimit / deduplication) but the new config requests them, the cache entry is evicted and recreated (`lib/logger.js` `logger()` function).

**Stack trace capture is synchronous.** `wrapLoggerMethod` captures `new Error().stack` *before* the `setImmediate` callback, then walks past internal Node.js frames (`_onTimeout`, `node:internal/*`, `node_modules/*`, etc.) to find the user's actual call site. Moving the capture inside the async callback would lose the caller. Keep this in mind when modifying `lib/logger.js`.

**Log levels (lowest to highest priority):** `fatal(0)`, `error(1)`, `warn(2)`, `info(3)`, `debug(4)`, `trace(5)`, `internal(6)`.

## Pino Support

`ntlogger/pino` provides a Pino-compatible transport and logger factory.

**Files:**
- `transports/pino.js` — Pino transport (consumes JSON stream, outputs NTL-formatted lines)
- `pino.js` — Entry point for `require('ntlogger/pino')`, exports transport + `createLogger()`

**The transport reuses `lib/colors.js` for level colors.** Utility ANSI codes (reset, dim, grey, etc.) are defined locally in the transport since `lib/colors.js` only exports level-keyed colors (`colors.console.info`, `.error`, etc.), not named utility codes.

**`split2` is an `optionalDependencies` entry** (used by `transports/pino.js` to consume the Pino JSON stream) and `pino` is an optional peer dependency — Winston-only users don't install either.

**Tests:** `tests/pino-transport.test.js` — tests `formatLine()`, `formatTimestamp()`, `padLevel()` directly (no Pino instance needed).

## Testing Patterns

- Tests use the in-memory Jest plugin: `plugins: [{name: 'Jest', enabled: true, config: {}}]`
- After logging, tests must wait for the async wrapper: `await new Promise(resolve => setImmediate(resolve))`
- Assert against the Jest transport's logged entries

## CI/CD

GitHub Actions (`.github/workflows/main.yml`): triggers on version tags → runs tests (Node 20) → publishes to npm via OIDC trusted publishing.

## Known Issues (from source comments)

- Syslog plugin has incorrect log level mappings
- Location tracking bug when calling across files (cache carries over)
