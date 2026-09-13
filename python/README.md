# ntlogger Python companion

A dependency-free adapter for Python 3.10+ `logging`, maintained alongside the Node
package. This is a new local package at version 0.1.0; it has not been published to PyPI.

Install from this repository into your application's environment:

```sh
python -m pip install /path/to/NightTimeLogger/python
```

## Existing handlers and agent modes

Keep the application's handler objects, log paths, rotation policies and lifecycle.
Only replace their formatters, after the application has created its per-mode handlers:

```python
from ntlogger import protect_handler

protect_handler(file_handler, json_output=True, mode="watchdog")
protect_handler(console_handler, mode="watchdog")
```

For Kaleidoscope, call this for each named and root handler created in `setup_logging`,
including emergency console handlers. Run it again when `set_mode_context` rebuilds
handlers. Pass the actual mode: service, watchdog, collect, tray, tray_watchdog, etc.
Do not consolidate their files or replace `SafeRotatingFileHandler`. This package
neither opens/closes handlers nor configures root logging or process signal handlers.
Switching files to NDJSON is opt-in; check any existing text readers before adoption.

`SafeFormatter` wraps the existing console/text formatter and adds sanitized exception
stacks even when that formatter omits `exc_info`. It formats a copy of the record, so
other handlers are not modified. `NdjsonFormatter` emits one JSON line with epoch-ms
`time`, Pino numeric `level`, `msg`, `module`, `service`, `pid`, `hostname`, extra fields
and `err` for exceptions. TRACE level 5 maps to Pino 10. No global TRACE monkeypatch is
installed: use `logger.log(ntlogger.TRACE, ...)` or the agent's existing trace method.

## Context and secrets

```python
from ntlogger import log_context, secret_values

with log_context(agent_uuid="a1", run_id="r1", work_id="w1"):
    with secret_values([password_from_credential_store]):
        logger.info("scan started", extra={"device_id": "d1"})
        try:
            run_scan()
        except Exception:
            logger.exception("scan failed")
```

Snake-case correlation keys become camelCase. Nested contexts restore their parents
on exit, including exceptions, and async tasks inherit context independently. Call-site
`extra` fields override bound context, but cannot replace structural timestamp/level/message
fields. Scope values are explicit nonempty strings, limited to 128 distinct secrets of
at most 65536 characters each. Scope exit restores the parent; child tasks retain inherited
context until they finish. Do not spawn unrelated background work within a secret scope.
Values are replaced literally (including JSON-escaped forms), so very short secrets can
also obscure ordinary text. No attempt is made to decode arbitrary encodings/hashes.

Key and pattern redaction comes from the Node package's generated defaults, including
SNMP communities and auth/priv passwords, passphrases, authorization headers, tokens,
URL passwords and private keys. Extra keys are supported through
`Redactor(extra_keys=["customer_secret"])`, passed as `redactor=` to a formatter.
Unknown structured objects become `[Object]` instead of invoking arbitrary repr methods;
use explicit primitive fields. Cycles and depth/string limits are bounded; messages are
limited to the contract's 4096-character maximum after redaction.

For threaded queue logging, capture context at the producer:

```python
from ntlogger import SnapshotFilter
queue_handler.addFilter(SnapshotFilter(mode="service"))
```

Use an ntlogger formatter on listener handlers. Handlers that bypass formatting need
a sanitized record (via `SnapshotFilter`); replacing their formatter alone is insufficient. `SnapshotFilter` sanitizes and snapshots
the record before it enters the queue and intentionally mutates it for compatibility
with Python 3.10/3.11. It retains no raw exception object or secret-value scope in the
queued record. Plain threads do not automatically inherit contextvars; use an explicit
`contextvars.copy_context()` when moving work to a new thread.

## Tests

```python
from ntlogger import create_test_logger

with create_test_logger() as captured:
    captured.logger.warning("retry", extra={"community": "public"})
    assert captured.records[0]["community"] == "[REDACTED]"
```

Capture uses an isolated standard Logger with no root/global configuration changes.
It defaults to TRACE; `level=` controls filtering. The context manager removes/closes
its own capture handler only. Captured records stay available after exit.

From the repository root:

```sh
node scripts/sync-python-contract.cjs --check
python -W error -m unittest discover -s python/tests
python scripts/test-python-package.py
```

The last command builds a wheel in a temporary environment, installs it into a separate
environment without dependencies, and exercises it outside the source tree. Build tools
require registry access; runtime has no external dependencies. Shared conformance data
covers redaction and level mapping. There is no Python OTel exporter or durable delivery
queue in this initial companion; those remain application-owned integrations.
