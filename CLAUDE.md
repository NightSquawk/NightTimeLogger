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
- `transports/pino.js` — Pino transport (consumes JSON stream, outputs NTL-formatted lines). Runs inside Pino's **worker thread**; must never require `lib/processHandlers.js`.
- `pino.js` — Entry point for `require('ntlogger/pino')`. Exports the transport plus `createLogger()`, `isSilent()`, `installProcessHandlers()`, `drainLogger()`.
- `lib/secretRedaction.js` — `createRedactor(opts)` → `{ redactString, redactObject, redact, isSensitiveKey }`. Key matching + secret-shape patterns. Never throws, never mutates.
- `lib/pinoHooks.js` — `createPinoFeatures({ sampling, rateLimit, deduplication, levels, defaultLocation })` → a `hooks.logMethod` implementation backed by `lib/logSampler.js` / `lib/logDeduplicator.js`.
- `lib/processHandlers.js` — `installProcessHandlers(logger, opts)` / `drainLogger(logger, timeout)`. Winston-free, opt-in only.

**Pino allows exactly ONE `hooks.logMethod`.** `pino.js` composes them into a single function: redact the message string and interpolation args first, then delegate to `features.logMethod` when features are enabled, else `method.apply(this, args)`. Never register two hooks.

**`formatters.log` runs BEFORE serializers** (see `_asJson` in `pino/lib/tools.js`), so a real `Error` under the `err` key is deliberately left untouched by the log formatter and redacted by a dedicated `serializers.err` instead — otherwise Pino reports `"type":"Object"`.

**`formatters.bindings` only ever sees `base`.** Pino's `child()` resets it to the identity function, so `pino.js` overrides `child()` on the returned logger to redact child bindings.

**`getStats`/`resetStats`/`close`/`child` are own, non-enumerable properties of the returned logger.** Pino's `child()` is `Object.create(parent)`, so children inherit them through the prototype chain — never attach to `Object.getPrototypeOf(logger)`, which is Pino's shared prototype.

**Silent mode:** `opts.silent` (boolean) → `NTLOGGER_SILENT` (`1|true|yes` / `0|false|no`) → `NODE_ENV === 'test'`. Jest sets `NODE_ENV=test`, so any test asserting on `createLogger` output must pass `silent: false`.

**The transport reuses `lib/colors.js` for level colors.** Utility ANSI codes (reset, dim, grey, etc.) are defined locally in the transport since `lib/colors.js` only exports level-keyed colors (`colors.console.info`, `.error`, etc.), not named utility codes.

**`split2` is an `optionalDependencies` entry** (used by `transports/pino.js` to consume the Pino JSON stream) and `pino` is an optional peer dependency — Winston-only users don't install either.

**Tests:**
- `tests/pino-transport.test.js` — `formatLine()`, `formatTimestamp()`, `padLevel()` directly (no Pino instance needed).
- `tests/pino-createLogger.test.js` — `createLogger()` options, using the undocumented `opts.destination` passthrough to capture JSON in-process.
- `tests/pino-consumer.test.js` — end-to-end through the real worker transport, in a child process.

## Testing Patterns

- Tests use the in-memory Jest plugin: `plugins: [{name: 'Jest', enabled: true, config: {}}]`
- After logging, tests must wait for the async wrapper: `await new Promise(resolve => setImmediate(resolve))`
- Assert against the Jest transport's logged entries

## CI/CD

GitHub Actions (`.github/workflows/main.yml`): triggers on version tags → runs tests (Node 20) → publishes to npm via OIDC trusted publishing.

## Known Issues (from source comments)

- Syslog plugin has incorrect log level mappings
- Location tracking bug when calling across files (cache carries over)


## In-the-Moment Activity Logging (Billing)

NightTimeLogger is an NST-internal repo: work here defaults to **NST-internal** (`kimai_candidate: no`) but must still be logged - the NST master activity log is also the future-search index. If a task is a deliverable for a paying client or tenant, tag that client instead and set `kimai_candidate: yes`. **`{host}` is not optional and is not a label to leave literal** - determine it yourself before naming the file: run `hostname` (Linux/macOS) or `$env:COMPUTERNAME` (Windows PowerShell) / `echo %COMPUTERNAME%` (cmd), lowercase the result, keep only the part before the first dot, and replace anything that isn't `[a-z0-9_-]` with a dash. This applies even though this repo lives outside the NST vault - the inbox is shared across all NightSquawk repos and machines, and a stub filename with no host segment is itself a defect. Canonical SOP: `C:\Users\reyes\NightSquawk Tech\in-the-moment-logging-sop.md` (NST Rule 11).

Substantive = a feature, fix, refactor, build or packaging pass, release, deployment, or significant debugging session. Skip pure Q&A and code reading.

- **At task start:** spawn a **background** logging subagent (never block the real work) that writes a stub entry - one file per task - to `$NST_ACTIVITY_INBOX/YYYY-MM-DD-HHMM-{host}-{slug}.md` (Linux `/mnt/data/work/.activity-log-inbox/`; Windows `<data-drive>:\work\.activity-log-inbox\`) with frontmatter `client: NST-internal`, `status: stub`, `kimai_candidate: no`.
- **At task end:** complete the entry (`status: complete`): what was done, commit hashes + subjects, branch, VERSION or changelog bump if any, build artifacts, deploys, and any endpoints or systems touched.
- **Single write** to the NST inbox only. Never create activity-log files inside this repo, and never append `activity-log-YYYY-MM.md` directly - the single-writer consolidation pass owns the monthly logs.
- Automatic breadcrumbs are only a safety net: Claude writes `breadcrumbs-YYYY-MM.log` via the global `SessionEnd` hook; Codex writes `codex-breadcrumbs-YYYY-MM.log` via the global `Stop` hook. The subagent entry is what makes the work readable for billing. Short tasks may skip the stub and write one complete entry at the end.
