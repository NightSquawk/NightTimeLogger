# Next integration work

This review covers NightTimeLogger itself. The consuming API, worker and satellite
repositories were not inspected; the reported call counts, test scripts and OTLP
routing still need verification there.

| Request | Status and next step |
| --- | --- |
| Fastify | Implemented `createPinoOptions()` with shared context/redaction and redacted serializer output. Runtime tests use Fastify 5; TypeScript checks route inference. Adopt in the API and verify its custom serializers and request context setup. |
| Node test silence | Implemented `NODE_TEST_CONTEXT` detection in the Pino API with explicit override precedence. Remove redundant environment flags in consumers after adoption. Winston does not use this silent-mode resolver. |
| Captured test records | Implemented `createTestLogger()` in `ntlogger/pino`; replace consumers' handwritten sinks. |
| Lighter Pino install | Next packaging milestone: move both `winston` and `winston-transport` to optional peers, retaining development dependencies. This changes installation requirements for existing Winston users and needs release/migration notes. Test a packed install with only Pino, exercise production JSON and development worker transport, and ensure plugin imports remain lazy. The Pino subpath already avoids importing Winston, but installation still pulls it in. |
| Structured call sites | Ship an ESLint plugin subpath with a configurable logger receiver matcher. Start with warnings for interpolated first-argument templates. Only offer fixes for side-effect-free identifiers with unambiguous field names; member access, calls, existing metadata and Winston's message-first methods need review. Preserve expression evaluation and message meaning. The referenced consumer `eslint-rules/` directory is not in this package. |
| OTel | Existing `plugins/otel.js` is a Winston transport; it reads the active span. No equivalent Pino export bridge was found. First verify the API/worker pipeline with an actual active span and collector record. JSON trace fields alone do not prove OTLP delivery. An optional Pino bridge must emit in the application context, map Pino severity, export only redacted data, and define SDK ownership/flush behavior without installing a second global provider. |
| Tee hook | Define `onLog(record)` as a callback on each serialized, redacted record that survives filtering. It should include child bindings and context. Define callback error/reentrancy behavior and asynchronous delivery ownership before using it for WebSocket fan-out; a pre-serialization log-method hook alone is insufficient. Check compatibility across the supported Pino range before selecting a hook. |
| Per-level stats | Add emitted counts after filtering, shared by children and reset by `resetStats()`. Specify whether a count represents serialization or successful delivery; use serialization counts for benchmarks, with delivery errors tracked separately. Test sampling/dedup drops and silence. |
| Post-close behavior | Documented the existing backend distinction: Winston rejects later calls; the Pino helper drains/releases state without enforcing a closed flag. Unifying behavior requires a lifecycle change covering children, disabled levels, dynamic level changes and idempotent close. |

No version bump or release is included in this implementation pass.
