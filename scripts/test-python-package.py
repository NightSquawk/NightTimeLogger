"""Build and test an installed wheel without source-tree imports or runtime deps."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import venv

ROOT = Path(__file__).resolve().parents[1]


def interpreter(directory):
    return directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(*args, cwd=None):
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True)


with tempfile.TemporaryDirectory(prefix="ntlogger-python-package-") as temporary:
    work = Path(temporary)
    source = work / "source"
    shutil.copytree(ROOT / "python", source, ignore=shutil.ignore_patterns("__pycache__", "*.egg-info", "build", "dist"))
    builder, consumer = work / "builder", work / "consumer"
    venv.create(builder, with_pip=True)
    run(interpreter(builder), "-m", "pip", "install", "--disable-pip-version-check", "build")
    run(interpreter(builder), "-m", "build", "--wheel", "--outdir", work / "dist", source)
    wheel, = (work / "dist").glob("*.whl")
    venv.create(consumer, with_pip=True)
    run(interpreter(consumer), "-m", "pip", "install", "--no-index", "--no-deps", wheel)
    run(interpreter(consumer), "-I", "-c", '''
import io, json, logging, pickle, queue
from logging.handlers import QueueHandler
from importlib.metadata import metadata
from ntlogger import create_test_logger, log_context, secret_values, protect_handler, SnapshotFilter, NdjsonFormatter
assert not metadata('ntlogger').get_all('Requires-Dist')
with create_test_logger() as capture:
    with log_context(agent_uuid='a1'), secret_values(['opaque-secret']):
        capture.logger.log(5, 'opaque-secret', extra={'community': 'public'})
    assert capture.records[0]['level'] == 10
    assert capture.records[0]['community'] == '[REDACTED]'
    assert capture.records[0]['agentUuid'] == 'a1'
    assert capture.records[0]['msg'] == '[REDACTED]'
stream = io.StringIO()
handler = protect_handler(logging.StreamHandler(stream), json_output=True)
handler.handle(logging.LogRecord('installed', 20, 'test.py', 1, 'authPassword=ab', (), None))
assert json.loads(stream.getvalue())['msg'] == 'authPassword=[REDACTED]'
handler.close()
q = queue.Queue()
producer = QueueHandler(q)
producer.addFilter(SnapshotFilter())
with log_context(run_id='r1'), secret_values(['opaque-queue-secret']):
    producer.handle(logging.LogRecord('queue', 20, 'test.py', 1, 'opaque-queue-secret', (), None))
queued = pickle.loads(pickle.dumps(q.get_nowait()))
record = json.loads(NdjsonFormatter().format(queued))
assert record['runId'] == 'r1' and record['msg'] == '[REDACTED]'
producer.close()
print('PASS: installed Python wheel, contract data, redaction, context and handler adapter')
''', cwd=work)
