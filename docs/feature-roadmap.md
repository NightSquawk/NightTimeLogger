# Next integration work

This review covers NightTimeLogger itself. The consuming API, worker and satellite
repositories were not inspected; the reported call counts, test scripts and OTLP
routing still need verification there.

| Request | Status and next step |
| --- | --- |
| Fastify | Implemented `createPinoOptions()` with shared context/redaction and redacted serializer output. Runtime tests use Fastify 5; TypeScript checks route inference. Adopt in the API and verify its custom serializers and request context setup. |
| Node test silence | Implemented `NODE_TEST_CONTEXT` detection in the Pino API with explicit override precedence. Remove redundant environment flags in consumers after adoption. Winston does not use this silent-mode resolver. |
| Captured test records | Implemented `createTestLogger()` in `ntlogger/pino`; replace consumers' handwritten sinks. |
| Lighter Pino install | Implemented optional peers for `winston` and `winston-transport`, retained as development dependencies. Packed consumer checks cover Pino-only production JSON, development worker formatting, TypeScript, and a Winston-only install. Existing Winston users must add both peers explicitly; README documents this breaking installation change in v4.0.0. |
| Structured call sites | Implemented `ntlogger/eslint` with configurable receiver names and conservative primitive-const autofixes. Enable the rule and migrate complex call sites in consumers. |
| OTel | Implemented opt-in application-provider bridge, active-span JSON fields, redacted SDK emission and provider flush. Tests cover real SDK records and local HTTP OTLP delivery. Verify routing and avoid duplicate pipelines when adopting in the API/workers. |
| Tee hook | Implemented detached redacted `onLog(record)` callbacks on Pino and Winston, async shutdown draining, error counts and async recursion suppression. Wire consumer WebSocket delivery through this callback. |
| Per-level stats | Implemented shared per-level emitted counts and hookErrors in getStats(), cleared by resetStats(). Counts represent serialization, not successful delivery. |
| Post-close behavior | Implemented Pino closed-state enforcement for all level methods, extracted methods, dynamic level changes and descendants. Close is idempotent; child close leaves its parent open. Pino still returns a drain result while Winston rejects drain failures. |

These changes ship in v4.0.0. The [release notes](releases/v4.0.0.md) document optional Winston peers, the Pino 9.14 minimum, Winston default redaction, and Pino closed-state enforcement.

Agent review follow-up implemented: scanner credential keys/free-text redaction; scoped
literal-value redaction; bounded async callbacks with drop/pending metrics; operation
context fields; a dependency-free Python companion under `python/`; and generated
shared redaction/level conformance data. The old untested Python documentation sketch
was replaced by the companion usage. Agent files and deployed endpoints remain unchanged.
