# NightSquawk Cross-Language Log Contract

`contractVersion: 1`

## 1. Purpose and scope

NightSquawk runs logging across tiers that cannot share a single library: Kaleidoscope
(Node/TypeScript, `ntlogger/pino`), kaleidoscope-agent (Python 3.11, stdlib `logging`), a
planned Rust broker tier, and Kaleidoscope itself acting as an OTLP log sink at
`POST /api/v1/otel/v1/logs`. This document is the shared *contract* those tiers implement
independently: field names, level names and numbers, the correlation vocabulary, error
shape, redaction expectations, message hygiene, HTTP request/response fields, and the
OpenTelemetry severity mapping. Conforming to it means a log line from any tier lands in
Kaleidoscope's sink with the same field names, the same level semantics, and the same
correlation ids, so one query works across all of them. The machine-checkable subset lives
in [`log-contract.schema.json`](./log-contract.schema.json); `tests/log-contract.test.js`
asserts this document's level table against `lib/levels.js` and `plugins/otel.js` so it
cannot silently drift from the code.

## 2. Wire format

**stdout / file:** one JSON object per line, newline-delimited (NDJSON). No leading
whitespace, no pretty-printing, no trailing commas, no ANSI escape sequences. One log
event is exactly one line; embedded newlines (stack traces) must be escaped inside JSON
string values, never emitted raw.

**Network:** OTLP LogRecord over `POST /api/v1/otel/v1/logs` (see §9). NDJSON is for local
consumption (console, file, `docker logs`, a shipper tailing a file); OTLP is the shipping
format.

**Human-readable console output is not part of this contract.** ntlogger's `transports/pino.js`
renders NDJSON into a colorized NTL line for developers; that rendering is a view, not a
wire format, and nothing downstream may parse it.

### Core fields

| Field | Type | Req. | Description | Example |
|---|---|---|---|---|
| `time` | integer | required\* | Event time, epoch **milliseconds**. Pino's default (`Date.now()`). | `1757600000123` |
| `timestamp` | string | required\* | Alternate for non-Pino emitters: ISO-8601 with explicit offset, millisecond precision. | `"2026-09-11T18:13:20.123Z"` |
| `level` | integer | required | Numeric severity. See §3. Pino numbering is canonical on the wire. | `30` |
| `levelName` | string | optional | Lowercase NTL level name. Recommended for non-Pino emitters. | `"info"` |
| `msg` | string | required | The message. Stable template text; variables go in fields (§7). | `"device registration accepted"` |
| `module` | string | recommended | Logical component. Node: `createLogger({ module })`. Python: `<mode>.<module path>`. | `"OtelIngestService"` |
| `service` | string | recommended | Process/service name. Matches OTLP `service.name`. | `"kaleidoscope-api"` |
| `serviceVersion` | string | optional | Build/release version. Matches OTLP `service.version`. | `"3.0.0"` |
| `pid` | integer | recommended | OS process id. Pino emits automatically. | `48210` |
| `hostname` | string | recommended | Host emitting the record. Matches OTLP `host.name`. | `"kal-api-01"` |
| `env` | string | optional | Deployment environment. | `"production"` |
| `err` | object | optional | Error payload. See §5. | see §5 |
| `req` / `res` / `responseTime` | see §8 | optional | HTTP lifecycle fields. | see §8 |

\* **Exactly one of `time` or `timestamp` is required, and sinks MUST accept either.**
Emitters SHOULD prefer `time` (epoch ms integer) — it is unambiguous, cheap, and what
Pino already produces. Emitters that cannot produce epoch ms cheaply (Python's
`logging.Formatter`, shell tooling) may emit `timestamp`. An emitter MAY emit both; if
both are present they MUST describe the same instant and sinks MUST prefer `time`.

**Pino emitters omit `levelName`; sinks derive it from `level`.** Do not add a `levelName`
mixin to a Pino logger just to satisfy a reader — the numeric table in §3 is total over the
Pino level set and derivation is unambiguous. Non-Pino emitters SHOULD include `levelName`
because their numbering may be their runtime's (Python's `logging` numbers, a Rust crate's
enum) rather than Pino's.

**Key casing is camelCase, always** — see §4. Unknown extra top-level keys are permitted
(`additionalProperties: true`); sinks must not reject a record for carrying fields they
don't understand.

## 3. Level table

Names are NTL's seven levels. The "NTL number" column is `lib/levels.js` (Winston-style,
**lower number = higher severity**). The "Pino number" column is the canonical wire value
for the `level` field (**higher number = higher severity**). Note the two numberings run in
opposite directions; this is the single most common source of mapping bugs.

<!-- BEGIN:LEVEL-TABLE -->

| NTL name | NTL number | Pino number | Python `logging` | OTel SeverityNumber | OTel SeverityText | Syslog severity |
|---|---|---|---|---|---|---|
| fatal | 0 | 60 | 50 | 21 | FATAL | 2 |
| error | 1 | 50 | 40 | 17 | ERROR | 3 |
| warn | 2 | 40 | 30 | 13 | WARN | 4 |
| info | 3 | 30 | 20 | 9 | INFO | 6 |
| debug | 4 | 20 | 10 | 5 | DEBUG | 7 |
| trace | 5 | 10 | 5 | 1 | TRACE | 7 |
| internal | 6 | 5 | 5 | 1 | TRACE | 7 |

<!-- END:LEVEL-TABLE -->

Notes:

- **Python names differ**: `logging.WARNING` (30) is NTL `warn`, `logging.CRITICAL` (50) is
  NTL `fatal`. kaleidoscope-agent's `utils/logger_format.py` already maps these to the NTL
  names for display; the JSON formatter must map them the same way.
- **`TRACE = 5`** is a custom level in both Python (`utils/logger.py` registers it) and
  ntlogger.
- **`internal` has no Pino or Python equivalent.** Two conforming options, in order of
  preference:
  1. Register a Pino custom level `internal` at numeric value **5** (`customLevels:
     { internal: 5 }`), which keeps it strictly below `trace` (10) and preserves the NTL
     ordering. Sinks that don't know the name still order it correctly.
  2. Fold it into `trace` (emit `level: 10`) and set `levelName: "internal"` so the
     distinction survives for search even though ordering collapses.
  Either way `internal` maps to OTel SeverityNumber `1` / `TRACE`, which is what
  `plugins/otel.js` already does.
- **Syslog severity** is derived by Kaleidoscope's ingest from the OTel SeverityNumber
  (`otlpSeverityToSyslog` in `packages/core/src/integrations/otel/shared.ts`): 1–8 → 7
  (debug), 9–12 → 6 (info), 13–16 → 4 (warning), 17–20 → 3 (err), 21–24 → 2 (crit),
  0/unknown → 6 (info). Emitters do not set it; it is listed so you can predict what the
  Log Explorer shows.
- Emitters MUST NOT invent intermediate numeric levels (e.g. `level: 35`). OTel permits
  them; the Kaleidoscope sink buckets them, but the NTL name becomes ambiguous.

## 4. Context keys — the correlation vocabulary

These are the fields that make cross-tier queries work. **They live at the TOP LEVEL of the
JSON object, not nested under `context`, `ctx`, `extra`, or `fields`.** A nested context
object is not searchable by the same query as a flat one, and OTLP attribute flattening
(§9) would turn it into a single JSON-stringified blob.

**Naming rule: camelCase JSON keys, always.** Python emitters hold these as snake_case
internally (`command_id`, `agent_uuid`, `tenant_id`) and MUST convert on the way out. Rust
emitters do the same from `snake_case` struct fields. There is exactly one accepted spelling
per concept on the wire.

| Key | Type | Who sets it | Notes |
|---|---|---|---|
| `tenantId` | string | Kaleidoscope API/worker from the authenticated principal; agent from its registration | Never from a request body. |
| `userId` | string | Kaleidoscope auth layer | Acting user. Null for system/worker-originated work. |
| `actorName` | string | Kaleidoscope auth layer | Display name; convenience only — never join on it. |
| `sessionId` | string | Kaleidoscope auth layer | Auth session. `transports/pino.js` will render it as the `[ID: …]` label if no `reqId`. |
| `correlationId` | string | Whichever tier starts the causal chain; propagated downstream | Free-form but stable for the life of the operation. |
| `traceId` | string | OTel SDK, or minted at the edge | **W3C hex, exactly 32 lowercase hex chars.** All-zero is "absent", not a value. |
| `spanId` | string | OTel SDK | **W3C hex, exactly 16 lowercase hex chars.** |
| `jobId` | string | Kaleidoscope worker (`jobAuditContext`) | Queue job identifier. |
| `attempt` | integer | Kaleidoscope worker | Retry attempt number, 1-based. |
| `executor` | string | Kaleidoscope | Who is running the work, e.g. `"worker"`, `"api"`, `"agent"`. |
| `impersonatorUserId` | string | Kaleidoscope auth layer | Set only during impersonation; its presence is itself a signal. |
| `agentUuid` | string | kaleidoscope-agent (`utils/agent_id_manager.generate_agent_uuid`) | Deterministic per-install UUID. Python-side `agent_uuid`. |
| `commandId` | string | kaleidoscope-agent when executing a server-dispatched command (`communication/api_router.py`) | Python-side `command_id`. |
| `collectionCycleId` | string | kaleidoscope-agent `collect` mode | One id per collection sweep, so all collector output for a sweep groups. |
| `runId` | string | Scanner runtime | One scanner execution. |
| `workId` | string or null | Scanner lease | Assigned work; null for local scheduled scans. |
| `stageId` | string or null | Scanner orchestration | Optional scan stage. |
| `deviceId` | string | Device inventory | Stable device identifier when available. |
| `reqId` | string | HTTP framework (Fastify/pino-http) | Per-request id. Canonical spelling for HTTP. |
| `requestId` | string | Non-Fastify emitters | Accepted alias of `reqId`. Emit **one** of the two, not both; `reqId` preferred. |

`transports/pino.js` renders a subset of these (`CONTEXT_KEYS`: `tenantId`, `userId`,
`correlationId`, `traceId`, `spanId`, `jobId`, `agentUuid`, `commandId`,
`collectionCycleId`, `runId`, `workId`, `stageId`, `deviceId`) as a compact
`{k=v …}` suffix. That render list is a display convenience; the full vocabulary above is
what the contract covers, and unrendered keys are still present in the JSON.

Kaleidoscope's `AuditContext` (`packages/core/src/lib/audit-context.ts`) is the Node-side
source of truth for most of these and already uses exactly these spellings. Fields it holds
that are **not** part of this contract because they are audit-only or privacy-sensitive —
`ipAddress`, `userAgent`, `guiContext`, `auditActions`, `impersonatorName`,
`originAuthSessionId` — may be logged deliberately but are not expected by sinks and are not
in the schema.

## 5. Error representation

Errors go in a top-level `err` object matching Pino's standard `err` serializer, so
`logger.error({ err }, 'message')` in Node is already conforming.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `type` | string | recommended | Constructor/class name — `"TypeError"`, `"ForbiddenError"`, `"requests.HTTPError"`. |
| `name` | string | optional | Accepted alias of `type` for emitters that produce `name`. Sinks read `type ?? name`. |
| `message` | string | required | Error message. |
| `stack` | string | optional | Full stack, newlines escaped inside the JSON string. |
| `code` | string \| integer | optional | `ECONNREFUSED`, `ETIMEDOUT`, an HTTP status, an app error code. |
| `cause` | object | optional | Same shape, recursively. Depth-limit at 3 and drop the rest. |

Rules:

- `msg` describes what failed in stable words; `err.message` carries the dynamic detail. Do
  not concatenate the error into `msg` (§7).
- Never put an Error object anywhere other than `err`. A raw `Error` stringifies to `{}` in
  JSON on most runtimes and the information is simply lost.
- Python: convert `record.exc_info` into the same shape —
  `{"type": exc_type.__name__, "message": str(exc_value), "stack": "".join(traceback.format_exception(...))}`.
  Do not emit Python's `exc_text` as a bare appended string.
- Stack traces are redacted like any other value (§6).

## 6. Redaction

**Redaction happens at the emitter, before the value reaches a transport, and again at the
sink.** A sink-only strategy is not sufficient (the value already hit stdout, the local file,
and the container log driver); an emitter-only strategy is not sufficient (a
non-conforming or older emitter may ship anything). Both sides implement it.

Replacement literal: **`[REDACTED]`** (exact, uppercase, bracketed). Redact the *value*,
keep the *key* — the key's presence is diagnostically useful and non-sensitive. Kaleidoscope's
OTLP ingest uses the lowercase sentinel `[redacted]` for its own `redactBody` config path;
that is a separate sink-side feature and does not change the emitter literal specified here.

### Canonical sensitive key names

Matched case-insensitively, ignoring `-`/`_` separators, at any nesting depth:

`password`, `passwd`, `pass`, `pwd`, `secret`, `token`, `apiKey` / `api_key` / `x-api-key`,
`authorization`, `proxy-authorization`, `cookie`, `set-cookie`,
`x-device-installation-secret`, `installationSecret`, `privateKey`, `clientSecret`,
`accessToken`, `refreshToken`, `idToken`, `sessionToken`, `credential`, `credentials`,
`webhookUrl`, `snmpCommunity`.

### Pattern classes

Redacted by value shape even when the key is innocuous (`msg`, `url`, `note`):

- `Bearer <token>` and `Basic <base64>` authorization values
- JWTs (three base64url segments separated by `.`)
- AWS access key ids and secret access keys
- GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`)
- Slack tokens (`xox[baprs]-…`) and Slack webhook URLs
- Stripe keys (`sk_live_`, `rk_live_`, `pk_live_`)
- PEM blocks (`-----BEGIN … PRIVATE KEY-----` … `-----END …-----`)
- URL-embedded credentials (`scheme://user:password@host` → redact the userinfo component)
- Discord webhook URLs (redact the token segment, keep the id)

### Implementation

The Node implementation is **`lib/secretRedaction.js`** in this repository — use it rather
than re-deriving the key list. Python and Rust emitters implement the same key list and
pattern classes; the list above is the normative copy and all implementations are expected
to track it.

Additional rules:

- Redaction must be applied to nested objects and arrays, to `err.stack`, and to
  `req.url` query strings.
- Redaction must never throw. A redactor that fails should drop the value entirely rather
  than let the original through.
- Sinks that store a verbatim copy of the record (Kaleidoscope stores `raw`) must apply
  their redaction to that copy too, or the redaction is defeated by reading the copy.

## 7. Message hygiene

**`msg` is a stable template; variable parts go in fields.** This is what makes
deduplication, aggregation, and search work.

```jsonc
// Bad — every line is unique; no aggregation, no dedup, no search by device.
{ "msg": "device 41822 registration failed after 3 attempts in 812ms" }

// Good
{ "msg": "device registration failed", "deviceId": "41822", "attempt": 3, "durationMs": 812 }
```

ntlogger's deduplicator normalizes messages before grouping (`lib/messageNormalizer.js`),
masking UUIDs, hex strings of 32+ chars, numbers following `device|id|threshold|ticket|job|request|user|session`,
standalone numbers of 4+ digits, and `YYYY-MM-DD HH:MM:SS` timestamps. Those masked classes
are exactly the things that should never have been in the message text — treat the
normalizer's mask list as a lint rule for message authors, not as a license to inline values.

Further rules:

- **No ANSI escape sequences in structured output, ever.** Color is applied by a console
  renderer downstream. `plugins/otel.js` strips ANSI defensively before export; do not rely
  on it.
- **Recommended max `msg` length: 1 KiB**, hard cap 4 KiB. Long payloads belong in a field,
  and a field that can be large should be truncated by the emitter with an explicit marker
  (e.g. `bodyTruncated: true`). Kaleidoscope caps the verbatim `raw` copy at 32 KiB — records
  above that lose data silently on the sink side.
- No trailing punctuation, no leading timestamp/level/`[Module]` prefix — separate fields.
- Lowercase, present-tense, no interpolation: `"job dispatch failed"`, not
  `"Failed to dispatch job #4181!"`. Multi-line text belongs in `err.stack` or a field.

## 8. HTTP request/response lines

Matches Pino/Fastify and what `transports/pino.js` pairs into a single rendered line.

Request start:

```json
{"time":1757600000123,"level":30,"reqId":"req-91","msg":"incoming request",
 "req":{"id":"req-91","method":"POST","url":"/api/v1/devices"}}
```

Request completion:

```json
{"time":1757600000180,"level":30,"reqId":"req-91","msg":"request completed",
 "res":{"statusCode":201},"responseTime":57.4}
```

| Field | Type | Notes |
|---|---|---|
| `req.id` | string | Same value as top-level `reqId`. |
| `req.method` | string | Uppercase HTTP method. |
| `req.url` | string | Path + query. Query string is subject to §6 redaction. |
| `res.statusCode` | integer | 100–599. |
| `responseTime` | number | Milliseconds, fractional allowed. |

Rules:

- The two lines are correlated by `reqId` (aliases `requestId`, then `sessionId`, in that
  precedence order — this is the lookup order `transports/pino.js` uses).
- The completion line may omit `req` entirely; the renderer and the sink recover method and
  URL from the tracked start line. Emitters that can cheaply include `req` on the completion
  line SHOULD, since a sink that received only the completion line otherwise has no route.
- `msg` on these lines is boilerplate (`"incoming request"`, `"request completed"`) and
  carries no information; do not put the route in it.
- The request tracker is bounded (1000 in-flight, 60 s TTL by default). A request pair
  separated by more than the TTL will render without its route. Do not treat the pairing as
  durable state.

## 9. OTLP mapping

Shipping to `POST /api/v1/otel/v1/logs` maps the NDJSON record onto an OTLP `LogRecord`:

| NDJSON | OTLP LogRecord | Rule |
|---|---|---|
| `time` / `timestamp` | `timeUnixNano` | Epoch **nanoseconds**, string-encoded uint64. `time * 1_000_000`. |
| — | `observedTimeUnixNano` | Set by the shipper at export time. Ingest falls back to it, then to receive time. |
| `level` | `severityNumber` | Per §3. |
| `levelName` | `severityText` | Uppercase NTL name (`INFO`, `WARN`, …) per §3. |
| `msg` | `body` | `AnyValue` string. |
| `traceId` | `traceId` | 32 lowercase hex. Present-but-invalid is **rejected**, not stored. |
| `spanId` | `spanId` | 16 lowercase hex. Same rejection rule. |
| everything else | `attributes` | Flattened key/value pairs, see below. |
| `service` | resource attr `service.name` | Also becomes `syslog_events.app_name` (first 100 chars). |
| `serviceVersion` | resource attr `service.version` | — |
| `hostname` | resource attr `host.name` | Also becomes `syslog_events.hostname`. |

**Attribute flattening rules** (from `plugins/otel.js` `_toAttributes`):

- `null`/`undefined` values are dropped.
- `timestamp` and `timeCreated` keys are dropped — they are carried by `timeUnixNano`.
- Strings pass through (ANSI stripped by default), numbers and booleans pass through as-is.
- Arrays pass through elementwise; object elements are JSON-stringified.
- Objects are JSON-stringified — **OTel attributes cannot nest.** This is why the context
  keys of §4 must be top-level: nested, they'd arrive as one opaque JSON string.
- Anything else is `String()`-coerced.

**How Kaleidoscope's ingest reads them** (`packages/core/src/integrations/otel/logs.ts` +
`services/otel-ingest.service.ts`): each `LogRecord` becomes one `syslog_events` row.
`severityNumber` → syslog `severity`/`severityName` via the §3 mapping; `body` → `message`;
resource `service.name` → `app_name`; resource `host.name` → `hostname`; `traceId`/`spanId` →
`correlation_trace_id`/`correlation_span_id`; resource attributes, scope, log attributes,
`severityNumber`, `severityText`, `flags`, and the decoded body are kept under
`structured_data.otel`; the verbatim record is stored in `raw` capped at 32 KiB. Category is
`exception` when the record carries `exception.type` / `exception.message` /
`exception.stacktrace` attributes or `severityNumber >= 17`, `invocation` for Cloudflare
Worker events, else `application` — so **conforming emitters that want error records
categorized as exceptions should also emit the OTel semantic-convention attributes**
`exception.type`, `exception.message`, `exception.stacktrace` alongside `err`. Records with a
malformed trace/span id or an unparseable timestamp are dropped and counted as `rejected`;
`facility` is fixed at 16 (`local0`) and `rfcVersion` is null — OTLP records never claim to
be syslog.

## 10. Emitter conformance checklists

### Node / ntlogger

`createLogger({ module })` from `ntlogger/pino` gives you automatically:

- `time` (epoch ms), `level` (Pino numbering), `msg`, `pid`, `hostname`
- `module`, via the mixin
- Pino's `err` serializer shape when you log `{ err }`
- `req`/`res`/`responseTime` when paired with `pino-http`/Fastify
- NTL-formatted console output in development; plain NDJSON when `NODE_ENV=production`

The application must supply:

- `service` / `serviceVersion` — pass as base bindings, e.g. `pino({ base: { service, serviceVersion, pid, hostname } })` or add to the mixin.
- Every context key of §4 that is in scope — read them out of `AuditContext`
  (`auditContext.getStore()`) and spread them into the log call's first argument, top level.
- Redaction via `lib/secretRedaction.js` before values reach the logger (or as a Pino
  `redact` path list for known-shape objects).
- `exception.*` attributes on error records if OTLP exception categorization matters (§9).
- `levelName` is **not** required and should not be added.

### Python (kaleidoscope-agent)

The tested companion package is in `python/` (install locally with
`python -m pip install ./python`). It requires Python 3.10+ and no runtime dependencies.
Use its formatter adapter on the application's existing handlers:

```python
from ntlogger import protect_handler, log_context, secret_values

# Keep SafeRotatingFileHandler, its per-mode path, rotation and ACL behavior.
protect_handler(file_handler, json_output=True, mode="service")
protect_handler(console_handler, mode="service")  # preserves the existing text formatter

with log_context(agent_uuid="a1", run_id="r1", work_id="w1"):
    with secret_values([credential_value]):
        logger.info("scan started", extra={"device_id": "d1"})
```

Python TRACE 5 maps to Pino **10**; DEBUG 10 maps to 20, INFO 20 to 30,
WARNING 30 to 40, ERROR 40 to 50 and CRITICAL 50 to 60. The adapter preserves
exception type/message/stack, normalizes correlation aliases and redacts both
text and structured output. Text wrapping also restores exception details when
a custom formatter only calls `record.getMessage()`.

For QueueHandler/QueueListener setups, attach `SnapshotFilter` to the **producer**
handler so context and redaction are captured before execution moves to another
thread. See [the companion README](../python/README.md) for lifecycle and scope rules.

Shared defaults and fixtures are in `contract/redaction.json` and
`contract/conformance.json`. Run `node scripts/sync-python-contract.cjs` after changing
JavaScript defaults; CI checks the generated snapshot and executes the same fixtures
in JavaScript and Python. Rust adapters can consume these fixtures without a JS runtime.

### Rust (broker tier)

Field names only, for whatever `tracing`/`slog` layer is chosen: emit `time` (epoch ms
integer) or `timestamp` (ISO-8601), `level` (Pino numbering), `levelName`, `msg`, `module`,
`service`, `serviceVersion`, `pid`, `hostname`; the §4 context keys camelCased at top level;
`err: { type, message, stack, code, cause }`; `req: { id, method, url }`,
`res: { statusCode }`, `responseTime`, `reqId` for HTTP. One JSON object per line, redaction
per §6 before the writer, no ANSI.

## 11. Versioning and compatibility

- The contract is versioned by the integer `contractVersion` at the top of this document and
  as a `const` in `log-contract.schema.json`. Emitters do **not** put `contractVersion` in
  every log line.
- **Additive changes** (a new optional field, a new context key, a new redaction key or
  pattern) do not bump the version. Sinks tolerate unknown keys by rule (§2), so additions
  are always safe.
- **Breaking changes** — renaming or removing a field, changing a field's type, changing a
  level's numeric value, changing the `[REDACTED]` literal — bump `contractVersion` and
  require a migration note listing every affected emitter.
- **Deprecation**: a field being removed stays marked deprecated here for at least one minor
  release of every consuming tier, during which emitters emit both spellings and sinks read
  the new one with the old as fallback (`requestId`/`reqId` is the current example).
- **Sinks must be forward-tolerant**: unknown fields, unknown level numbers, and unknown
  severity numbers are bucketed, never rejected. Only structurally invalid records
  (unparseable timestamp, present-but-malformed trace/span id) are rejected.
- **Emitters must be conservative**: emit only what is specified, in the specified spelling.
- The level table in §3 is enforced against `lib/levels.js` and `plugins/otel.js` by
  `tests/log-contract.test.js`. Changing a level in code without updating this table fails
  the test — that is deliberate.
