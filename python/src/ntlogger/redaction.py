"""Portable, dependency-free redaction using ntlogger's generated defaults."""
import json
import math
import re
from contextlib import contextmanager
from contextvars import ContextVar
from importlib.resources import files

CONTRACT = json.loads(files("ntlogger").joinpath("contract.json").read_text(encoding="utf-8"))
REDACTED = "[REDACTED]"
_SECRETS = ContextVar("ntlogger_secrets", default=())


@contextmanager
def secret_values(values):
    """Redact explicit values for this context and descendants; reset on exit."""
    if isinstance(values, (str, bytes)):
        raise TypeError("Secret values must be an iterable of nonempty strings")
    values = tuple(values)
    if any(not isinstance(value, str) or not value for value in values):
        raise TypeError("Secret values must be nonempty strings")
    combined = tuple(dict.fromkeys((*_SECRETS.get(), *values)))
    if len(combined) > 128 or any(len(value) > 65536 for value in combined):
        raise ValueError("Secret scope exceeds 128 values or 65536 characters per value")
    token = _SECRETS.set(combined)
    try:
        yield
    finally:
        _SECRETS.reset(token)


def _key(value):
    return value.lower().replace("-", "").replace("_", "")


class Redactor:
    def __init__(self, *, extra_keys=(), max_depth=8, max_string_length=16384):
        if not isinstance(max_depth, int) or max_depth < 0:
            raise ValueError("max_depth must be a nonnegative integer")
        if not isinstance(max_string_length, int) or max_string_length < 0:
            raise ValueError("max_string_length must be a nonnegative integer")
        self.keys = {_key(key) for key in (*CONTRACT["keys"], *extra_keys)}
        self.max_depth = max_depth
        self.max_string_length = max_string_length
        self.patterns = []
        for pattern in CONTRACT["patterns"]:
            # These canonical patterns use only portable regex constructs.
            source = re.sub(r"\(\?<([a-zA-Z]+)>", r"(?P<\1>", pattern["source"])
            source = source.replace('["\'[]', '["\'\\[]')
            self.patterns.append(re.compile(source, re.IGNORECASE if "i" in pattern["flags"] else 0))

    def redact_string(self, value):
        try:
            variants = set()
            for secret in _SECRETS.get():
                variants.update((secret, json.dumps(secret, ensure_ascii=False)[1:-1], json.dumps(secret)[1:-1]))
            if variants:
                pattern = "|".join(re.escape(s) for s in [REDACTED, *sorted(variants, key=len, reverse=True)])
                value = re.sub(pattern, lambda _: REDACTED, value)
            for pattern in self.patterns:
                value = pattern.sub(lambda match: (match.groupdict().get("pre") or "") + REDACTED + (match.groupdict().get("post") or ""), value)
            if len(value) > self.max_string_length:
                value = value[:self.max_string_length] + "...[truncated]"
            return value
        except Exception:
            return REDACTED

    def redact(self, value):
        def walk(item, depth, seen):
            if isinstance(item, str):
                return self.redact_string(item)
            if item is None or isinstance(item, (bool, int)):
                return item
            if isinstance(item, float):
                return item if math.isfinite(item) else None
            if depth > self.max_depth:
                return "[Object]"
            if id(item) in seen:
                return "[Circular]"
            seen = seen | {id(item)}
            if isinstance(item, dict):
                result = {}
                for key, child in item.items():
                    key = str(key)
                    result[key] = REDACTED if _key(key) in self.keys and child is not None else walk(child, depth + 1, seen)
                return result
            if isinstance(item, (list, tuple)):
                return [walk(child, depth + 1, seen) for child in item]
            # Unknown objects may implement unsafe repr/str; never serialize them implicitly.
            return "[Object]"
        try:
            return walk(value, 0, set())
        except Exception:
            return REDACTED
