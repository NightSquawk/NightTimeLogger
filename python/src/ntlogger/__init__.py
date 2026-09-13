"""Logging adapters that leave handlers, rotation and process ownership to the app."""
import copy
import json
import logging
import socket
import traceback
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from .redaction import CONTRACT, REDACTED, Redactor, secret_values

TRACE = 5
_CONTEXT = ContextVar("ntlogger_context", default={})
_STANDARD = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}
_LEVELS = {int(key): value for key, value in CONTRACT["pythonLevels"].items()}


def _aliases(fields):
    return {CONTRACT["contextAliases"].get(key, key): value for key, value in fields.items()}


@contextmanager
def log_context(**fields):
    """Bind correlation fields for this context, restoring the parent on exit."""
    token = _CONTEXT.set({**_CONTEXT.get(), **_aliases(fields)})
    try:
        yield
    finally:
        _CONTEXT.reset(token)


class _Snapshot(dict):
    """A pickleable marker distinguishing our safe snapshots from caller metadata."""


class RecordBuilder:
    def __init__(self, *, service="kaleidoscope-agent", mode="service", redactor=None):
        self.service, self.mode = service, mode
        self.redactor = redactor or Redactor()
        self.hostname = socket.gethostname()

    def build(self, record: logging.LogRecord) -> dict:
        snapshot = record.__dict__.get("_ntlogger_record")
        if isinstance(snapshot, _Snapshot):
            return self.redactor.redact(snapshot)
        fields = {key: value for key, value in record.__dict__.items() if key not in _STANDARD and not key.startswith("_")}
        out = {**_CONTEXT.get(), **_aliases(fields)}
        level = _LEVELS.get(record.levelno, 30)
        try:
            message = record.getMessage()
        except Exception:
            message = "[Unformattable log message]"
        # Call-site fields cannot overwrite the contract's structural fields.
        out.update(time=int(record.created * 1000), level=level, msg=message,
                   module=f"{self.mode}.{record.name}", service=self.service,
                   pid=record.process, hostname=self.hostname)
        if record.exc_info:
            try:
                kind, error, tb = record.exc_info
                out["err"] = {"type": kind.__name__, "message": str(error),
                              "stack": "".join(traceback.format_exception(kind, error, tb))}
            except Exception:
                out["err"] = {"message": "[Unformattable exception]"}
        if record.stack_info:
            out["stack"] = record.stack_info
        out = self.redactor.redact(out)
        if not isinstance(out, dict):
            out = {"time": int(record.created * 1000), "level": level, "msg": REDACTED}
        # Schema message limit; redact before truncating a secret value.
        if len(out["msg"]) > 4096:
            out["msg"] = out["msg"][:4082] + "...[truncated]"
        return out


class NdjsonFormatter(logging.Formatter):
    def __init__(self, **options):
        super().__init__()
        self.builder = RecordBuilder(**options)

    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(self.builder.build(record), ensure_ascii=False, allow_nan=False, separators=(",", ":"))


class SafeFormatter(logging.Formatter):
    """Retain the existing text layout and append redacted exception details."""
    def __init__(self, delegate=None, **options):
        super().__init__()
        self.delegate = delegate or logging.Formatter("%(message)s")
        self.builder = RecordBuilder(**options)

    def format(self, record: logging.LogRecord) -> str:
        safe = self.builder.build(record)
        cloned = copy.copy(record)
        # Sanitize every field exposed to an existing custom formatter.
        cloned.__dict__ = self.builder.redactor.redact(record.__dict__)
        if not isinstance(cloned.__dict__, dict):
            return REDACTED
        cloned.msg, cloned.args = safe["msg"], ()
        cloned.exc_info = cloned.exc_text = cloned.stack_info = None
        try:
            result = self.delegate.format(cloned)
        except Exception:
            result = safe["msg"]
        if safe.get("err"):
            result += "\n" + safe["err"].get("stack", safe["err"].get("message", ""))
        if safe.get("stack"):
            result += "\n" + safe["stack"]
        return self.builder.redactor.redact_string(result)


class SnapshotFilter(logging.Filter):
    """Snapshot/sanitize on a producer's QueueHandler before scopes disappear.

    Explicitly mutates the LogRecord for compatibility with Python 3.10/3.11.
    Attach to the producer handler, not only the QueueListener's handlers.
    """
    def __init__(self, **options):
        super().__init__()
        self.builder = RecordBuilder(**options)

    def filter(self, record: logging.LogRecord) -> bool:
        payload = self.builder.build(record)
        sanitized = self.builder.redactor.redact(record.__dict__)
        for key in list(record.__dict__):
            record.__dict__[key] = sanitized.get(key, REDACTED) if isinstance(sanitized, dict) else REDACTED
        record.msg, record.args = payload["msg"], ()
        record.exc_info = None
        record.exc_text = payload.get("err", {}).get("stack")
        record.stack_info = payload.get("stack")
        record._ntlogger_record = _Snapshot(payload)
        return True


def protect_handler(handler: logging.Handler, *, json_output=False, **options) -> logging.Handler:
    """Replace only formatting; preserve handler class, path, rotation and ownership."""
    existing = handler.formatter
    if isinstance(existing, SafeFormatter):
        existing = existing.delegate
    handler.setFormatter(NdjsonFormatter(**options) if json_output else SafeFormatter(existing, **options))
    return handler


@dataclass
class CapturedLogger:
    logger: logging.Logger
    records: list

    def close(self):
        for handler in self.logger.handlers[:]:
            self.logger.removeHandler(handler)
            handler.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def create_test_logger(*, level=TRACE, **options) -> CapturedLogger:
    records = []
    builder = RecordBuilder(**options)

    class CaptureHandler(logging.Handler):
        def emit(self, record):
            records.append(builder.build(record))

    # No registration or root mutation, so tests cannot affect application loggers.
    logger = logging.Logger("ntlogger-test", level)
    logger.propagate = False
    logger.addHandler(CaptureHandler())
    return CapturedLogger(logger, records)
