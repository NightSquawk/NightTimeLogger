import asyncio
import copy
import io
import json
import logging
import queue
import pickle
import sys
import tempfile
import unittest
from logging.handlers import QueueHandler, RotatingFileHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'src'))
from ntlogger import (NdjsonFormatter, SafeFormatter, SnapshotFilter, Redactor,
                      create_test_logger, log_context, protect_handler, secret_values)
from ntlogger.redaction import CONTRACT

FIXTURES = json.loads((ROOT / 'contract' / 'conformance.json').read_text())


class ContractTests(unittest.TestCase):
    def test_shared_snapshot(self):
        self.assertEqual(CONTRACT, json.loads((ROOT / 'contract' / 'redaction.json').read_text()))

    def test_shared_redaction_cases(self):
        redactor = Redactor()
        for case in FIXTURES['redaction']:
            with self.subTest(input=case['input']):
                self.assertEqual(redactor.redact(case['input']), case['expected'])
                self.assertEqual(redactor.redact(case['expected']), case['expected'])

    def test_all_sensitive_keys_and_normalization(self):
        for key in CONTRACT['keys']:
            with self.subTest(key=key):
                self.assertEqual(Redactor().redact({key.upper(): 'secret'}), {key.upper(): '[REDACTED]'})

    def test_level_mapping(self):
        with create_test_logger() as capture:
            for level in FIXTURES['levels']:
                capture.logger.log(level['python'], 'test')
            self.assertEqual([r['level'] for r in capture.records], [r['pino'] for r in FIXTURES['levels']])
            self.assertTrue(all(isinstance(r['time'], int) for r in capture.records))

    def test_caller_cannot_inject_a_snapshot(self):
        with create_test_logger() as capture:
            capture.logger.info('real message', extra={'_ntlogger_record': {'msg': 'unsafe'}})
        self.assertEqual(capture.records[0]['msg'], 'real message')

    def test_structural_fields_cannot_be_overwritten(self):
        with create_test_logger() as capture, log_context(level=60, service='wrong', module='wrong'):
            capture.logger.info('message', extra={'device_id': 'd1', 'time': -1})
            record = capture.records[0]
            self.assertEqual(record['level'], 30)
            self.assertEqual(record['deviceId'], 'd1')
            self.assertEqual(record['service'], 'kaleidoscope-agent')
            self.assertGreater(record['time'], 0)

    def test_cycles_unknown_objects_nonfinite_and_limits(self):
        cyclic = {}; cyclic['self'] = cyclic
        r = Redactor()
        self.assertEqual(r.redact(cyclic), {'self': '[Circular]'})
        class Hostile:
            def __str__(self):
                raise RuntimeError('do not stringify')
        self.assertEqual(r.redact(Hostile()), '[Object]')
        self.assertEqual(r.redact(float('nan')), None)
        with create_test_logger() as capture:
            capture.logger.info(Hostile())
            capture.logger.info('a' * 10000)
        self.assertEqual(capture.records[0]['msg'], '[Unformattable log message]')
        self.assertLessEqual(len(capture.records[1]['msg']), 4096)


class ContextTests(unittest.TestCase):
    def test_context_restores_on_exception_and_nests(self):
        with create_test_logger() as capture:
            with log_context(agent_uuid='a1', run_id='outer'):
                try:
                    with log_context(run_id='inner', work_id='w1'):
                        capture.logger.info('inner')
                        raise RuntimeError()
                except RuntimeError:
                    pass
                capture.logger.info('outer')
            capture.logger.info('none')
        self.assertEqual(capture.records[0]['runId'], 'inner')
        self.assertEqual(capture.records[0]['workId'], 'w1')
        self.assertEqual(capture.records[1]['runId'], 'outer')
        self.assertNotIn('workId', capture.records[1])
        self.assertNotIn('agentUuid', capture.records[2])

    def test_async_context_and_secret_isolation(self):
        with create_test_logger() as capture:
            async def job(value, other):
                with log_context(run_id=value), secret_values([value]):
                    await asyncio.sleep(0)
                    capture.logger.info('%s %s', value, other)
            async def run():
                await asyncio.gather(job('alpha-secret', 'beta-secret'), job('beta-secret', 'alpha-secret'))
            asyncio.run(run())
            capture.logger.info('alpha-secret')
        self.assertEqual(capture.records[0]['msg'], '[REDACTED] beta-secret')
        self.assertEqual(capture.records[1]['msg'], '[REDACTED] alpha-secret')
        self.assertEqual(capture.records[2]['msg'], 'alpha-secret')

    def test_secret_values_escape_restore_and_validation(self):
        r = Redactor()
        with secret_values(['a"b\nc', 'REDACTED']):
            value = 'a"b\nc ' + json.dumps('a"b\nc')
            safe = r.redact_string(value)
            self.assertNotIn('a"b', safe)
            self.assertNotIn('a\\"b', safe)
            self.assertEqual(r.redact_string(safe), safe)
        self.assertEqual(r.redact_string('a"b\nc'), 'a"b\nc')
        for values in [[''], 'secret', [None], [str(i) for i in range(129)]]:
            with self.subTest(values=type(values)):
                with self.assertRaises((TypeError, ValueError)):
                    with secret_values(values):
                        pass

    def test_queue_snapshot_keeps_scope_and_removes_raw_credentials(self):
        q = queue.Queue()
        handler = QueueHandler(q)
        handler.addFilter(SnapshotFilter(mode='watchdog'))
        logger = logging.Logger('queue', logging.DEBUG)
        logger.addHandler(handler)
        with log_context(run_id='r1'), secret_values(['opaque-secret']):
            try:
                raise RuntimeError('opaque-secret')
            except RuntimeError:
                logger.exception('opaque-secret', extra={'authPassword': 'another-secret'})
        queued = pickle.loads(pickle.dumps(q.get_nowait()))
        self.assertNotIn('opaque-secret', repr(queued.__dict__))
        self.assertNotIn('another-secret', repr(queued.__dict__))
        rendered = json.loads(NdjsonFormatter().format(queued))
        self.assertEqual(rendered['runId'], 'r1')
        self.assertEqual(rendered['module'], 'watchdog.queue')
        self.assertEqual(rendered['err']['message'], '[REDACTED]')
        handler.close()


class HandlerTests(unittest.TestCase):
    def test_text_formatter_preserves_layout_and_exception_without_mutating_record(self):
        class LegacyFormatter(logging.Formatter):
            def format(self, record):
                return 'legacy: ' + record.getMessage()
        try:
            raise ValueError('community=public')
        except ValueError:
            record = logging.LogRecord('test', logging.ERROR, __file__, 1, 'failed %s', ('passphrase=hello',), sys.exc_info())
        original = copy.copy(record.__dict__)
        output = SafeFormatter(LegacyFormatter()).format(record)
        self.assertTrue(output.startswith('legacy: failed passphrase=[REDACTED]'))
        self.assertIn('Traceback', output)
        self.assertIn('ValueError: community=[REDACTED]', output)
        self.assertNotIn('public', output)
        self.assertEqual(record.__dict__, original)

    def test_ndjson_preserves_exception_and_is_single_line(self):
        with create_test_logger() as capture, secret_values(['opaque-secret']):
            try:
                raise RuntimeError('opaque-secret\nsecond line')
            except RuntimeError:
                capture.logger.exception('failed')
        record = capture.records[0]
        self.assertEqual(record['err']['type'], 'RuntimeError')
        self.assertNotIn('opaque-secret', json.dumps(record))

    def test_existing_rotating_handler_identity_configuration_and_file_split_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            handlers = [RotatingFileHandler(Path(directory) / name, maxBytes=128, backupCount=2, encoding='utf-8') for name in ['service.log', 'watchdog.log']]
            try:
                for handler in handlers:
                    stream, filename = handler.stream, handler.baseFilename
                    self.assertIs(protect_handler(handler, json_output=True, mode='service'), handler)
                    self.assertIs(handler.stream, stream)
                    self.assertEqual(handler.baseFilename, filename)
                    self.assertEqual(handler.maxBytes, 128)
                    self.assertEqual(handler.backupCount, 2)
                    handler.handle(logging.LogRecord('test', 20, __file__, 1, 'password=secret', (), None))
                    handler.flush()
                    self.assertNotIn('password=secret', Path(filename).read_text())
            finally:
                for handler in handlers:
                    handler.close()

    def test_test_capture_is_isolated_and_filters_levels(self):
        before = list(logging.getLogger().handlers)
        with create_test_logger(level=logging.WARNING) as capture:
            capture.logger.info('filtered')
            capture.logger.warning('visible')
            self.assertEqual(len(capture.records), 1)
        self.assertEqual(logging.getLogger().handlers, before)
        self.assertEqual(capture.logger.handlers, [])


if __name__ == '__main__':
    unittest.main()
