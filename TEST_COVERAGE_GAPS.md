# Test Coverage Gaps

Generated from `npm test -- --coverage --coverageProvider=v8` analysis of NightTimeLogger.

## Baseline (before remediation)

| Scope                          | Stmts   | Funcs   | Branch  |
|--------------------------------|---------|---------|---------|
| All files                      | 56.49%  | 47.87%  | 75.28%  |
| `lib/`                         | 85.49%  | 83.33%  | 77.93%  |
| `plugins/`                     | 27.27%  | 16.66%  | 52.38%  |
| `transports/pino.js`           | 90.69%  | 75.00%  | 72.00%  |

The aggregate is dragged down by external-service plugins where only the module shape is exercised. The core `lib/logger.js` looks healthy on stmts but the branch number (65%) hides several user-facing code paths.

## Gaps by file

### `lib/logger.js` — core logger (78.76% stmts, 65.04% branch)

| Lines | What's uncovered | Why it matters |
|-------|------------------|----------------|
| 91-93 | `stripAnsiCodes` non-string input branch | Winston can pass Symbol/object levels |
| 114-115, 133-134 | `reportPath` + `filePath` formatter branches | The whole reportPath feature in console/file output |
| 196-215 | Stack-walk fallbacks in `wrapLoggerMethod` | Used when no non-internal frames are found |
| 236-240 | Object-form message: `log.info({ message, ...meta })` | Public API shape, advertised in `index.d.ts` |
| 255-256, 275-276 | Perf-tracker calls on sampler-/dedup-suppressed paths | Stats accuracy when features chain |
| 298-307 | Wrapper try/catch fallback to original method | The "logging never crashes" guarantee |
| 341-357 | File transports configuration block | Default behavior — every existing test passes `file: false` |
| 358-359 | Custom external `transports` argument | Third positional arg of `createLoggerInstance` |
| 442-453 | `logger.flush()` | Public API, zero tests |
| 458-469 | `logger.close()` | Public API, zero tests; should destroy sampler/dedup |
| 473-478 | `statsInterval` setInterval | Likely source of hung Jest handles if misused |
| 483-490 | `debug: true` config branch | Emits internal-level diagnostics |
| 517-532 | Cache invalidation when advanced features requested on cached logger | Documented behavior, untested |

### `lib/signalHandler.js` — 49.05% (handlers themselves never invoked)

Only `setupSignalHandlers` being called is covered. All five handlers (SIGINT, SIGTERM, SIGQUIT, uncaughtException, unhandledRejection) and the `cleanup()` body are uncovered.

### `lib/pathReporter.js` — 93.10% stmts, 76.92% branch

- Lines 38-39, 50-51: internal-function detection for `_onTimeout`, `timers.js`, `next_tick.js`, `promise.js`
- Lines 132-134, 138-140: alternative call-chain shapes + outer try/catch fallback
- Path-traversal guard (lines 103-123) — defense-in-depth code that has never been exercised by a test

### `lib/logSampler.js` — 88.40% stmts

- Lines 90-99: `cleanupRateLimits()` — public method
- Lines 117-122: `resetStats()` — public method

### `plugins/index.js` (loader) — 70.70% stmts, **23.07% branch**

Every error/skip branch is uncovered:
- Plugin missing `name` field
- Plugin with `enabled: false`
- Unknown plugin name
- Plugin config missing/null/non-object
- Transport class that isn't a constructor
- Top-level non-iterable config (e.g., `initPlugins({})`)

`CLAUDE.md` advertises "Failed plugins are logged and skipped, never crash the logger" — this is the file that delivers that guarantee, and none of its failure paths are tested.

### `plugins/<service>.js` — 0% function coverage on every external plugin

- `discord.js` (110 lines): 19.09%
- `mysql.js` (175 lines): 28.00%
- `openobserve.js` (331 lines): 17.57%
- `postgres.js` (139 lines): 22.14%
- `sentry.js` (51 lines): 50.98%
- `syslog.js` (84 lines): 40.47% — also flagged in `CLAUDE.md` for incorrect level mappings
- `teams.js` (311 lines): 7.07%
- `plugins/lib/syslogClient.js` (112 lines): 42.85%

Only the module's top-level requires and class declaration are scored — no `log()`/`logToService()` body is ever called by a test.

### `transports/pino.js` — 90.69% stmts, 72% branch

- Lines 109-112: HTTP completion branches when `req.method`/`req.url` are missing
- Lines 156-167: the actual `split(...)` stream wrapper — the exported transport entry point itself is untested; only the pure helpers are

## Phase 1 remediation (this batch)

Implemented in:

- `tests/plugins-loader.test.js` — covers all `plugins/index.js` error branches
- `tests/signalHandler.test.js` — registers handlers, invokes them directly with stubs
- `tests/logger-lifecycle.test.js` — flush/close, cache hit + cache invalidation, object-form message, `debug: true`, wrapper error-recovery
- `tests/pino-transport-stream.test.js` — stream wrapper with valid JSON, malformed JSON, HTTP completion edge cases
- `tests/pathReporter.test.js` extensions — internal-function file heuristics, path-traversal guard, outer try/catch fallback
- `tests/logSampler.test.js` extensions — `cleanupRateLimits()`, `resetStats()`

### Result (after Phase 1)

| Scope                          | Before  | After   | Δ        |
|--------------------------------|---------|---------|----------|
| All files (stmts)              | 56.49%  | 61.41%  | +4.92    |
| All files (branches)           | 75.28%  | 86.02%  | +10.74   |
| All files (funcs)              | 47.87%  | 54.25%  | +6.38    |
| `lib/` (stmts)                 | 85.49%  | 93.85%  | +8.36    |
| `lib/logger.js` (stmts)        | 78.76%  | 88.56%  | +9.80    |
| `lib/logger.js` (branches)     | 65.04%  | 77.44%  | +12.40   |
| `lib/signalHandler.js`         | 49.05%  | 100%    | +50.95   |
| `lib/logSampler.js`            | 88.40%  | 100%    | +11.60   |
| `lib/pathReporter.js`          | 93.10%  | 96.55%  | +3.45    |
| `plugins/index.js` (branch)    | 23.07%  | 85.71%  | +62.64   |
| `transports/pino.js` (stmts)   | 90.69%  | 100%    | +9.31    |

Tests: 59 → 96 (+37). All passing.

### Remaining gaps in `lib/logger.js`

- 92-93: `stripAnsiCodes` non-string short-circuit — hard to trigger without monkey-patching Winston
- 114-115, 125-142, 342-357: file-transport and console-with-reportPath formatter branches — requires file-system fixtures
- 196-197, 212-215, 218: stack-walk fallback edges — only fire when Error.prepareStackTrace returns malformed frames
- 232-234, 255-256, 275-276: alternative message-arg shape + perf-tracker-on-suppressed branches
- 303-306: fallback's own `console.error` when both wrapper and original method throw
- 447-448: flush() per-transport branch (only when a transport implements `flush()`)
- 474-478: `statsInterval` setInterval branch

These are mostly low-impact (defensive code, file-system side effects, observability-only). Worth tackling in a follow-up.

## Phase 2 (not in this batch)

External-service plugin transports require dedicated mocks for `mysql2/promise`, `pg`, `@sentry/node`, `https.request` (Discord/Teams/OpenObserve webhooks), and the syslog UDP/TCP socket. Each plugin needs at minimum:

1. Constructor accepts/rejects required config
2. `log()` invokes the right client method with the expected payload shape
3. Connection-failure paths don't throw out of `log()`

Fixing the documented "Syslog plugin has incorrect log level mappings" issue should be paired with a regression test in this phase.
