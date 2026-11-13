"""Exercise real polling helpers without starting the driver's top-level PTY journey."""
import ast
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

DRIVER = Path(__file__).with_name('drive.py')
TREE = ast.parse(DRIVER.read_text())
EVENTS = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'events')
ENABLED = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'enabled')
CLI = next(node for node in TREE.body if isinstance(node, ast.ClassDef) and node.name == 'Cli')
WAIT = next(node for node in CLI.body if isinstance(node, ast.FunctionDef) and node.name == 'wait')


class ConfigPollingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.root / 'config.json'
        self.clock = 0
        scope = dict(json=json, config=self.config, root=self.root,
                     time=SimpleNamespace(monotonic=lambda: self.clock))
        exec(compile(ast.Module(body=[ENABLED, WAIT], type_ignores=[]), str(DRIVER), 'exec'), scope)
        self.enabled, self.wait = scope['enabled'], scope['wait']

    def client(self, contents):
        states = iter(contents)
        client = SimpleNamespace(label='fixture', screens={}, file_states=[], status=None, view=lambda: 'screen')
        def pump():
            self.clock += 1
            text = next(states, None)
            if text is not None:
                self.config.write_text(text)
        client.pump = pump
        return client

    def test_poll_retries_truncated_and_partial_json_until_complete_boolean(self):
        for value in [True, False]:
            with self.subTest(value=value):
                client = self.client(['', '{"enabled":', json.dumps({'enabled': value})])
                observed = []
                def ready():
                    observed.append(self.enabled())
                    return observed[-1] is value
                self.wait(client, ready, 'persisted')
                self.assertEqual(observed, [None, None, value])
                self.assertIn('persisted', client.screens)
                self.assertEqual(json.loads(client.file_states[-1]['userConfig']), {'enabled': value})

    def test_persistent_malformed_json_still_times_out(self):
        client = self.client(['{"enabled":'])
        with self.assertRaisesRegex(AssertionError, 'fixture: persisted'):
            self.wait(client, lambda: self.enabled() is False, 'persisted')
        self.assertNotIn('persisted', client.screens)
        self.assertEqual(client.file_states, [])

    def test_wrong_boolean_still_times_out(self):
        client = self.client(['{"enabled": true}'])
        with self.assertRaisesRegex(AssertionError, 'fixture: persisted'):
            self.wait(client, lambda: self.enabled() is False, 'persisted')
        self.assertEqual(client.file_states, [])

    def test_missing_config_is_not_a_boolean(self):
        self.assertIsNone(self.enabled())

    def test_unrelated_io_errors_are_not_suppressed(self):
        path = Mock()
        path.read_text.side_effect = PermissionError('denied')
        with self.assertRaises(PermissionError):
            self.enabled(path)


class EventPollingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.path = root / 'events.jsonl'
        scope = dict(json=json, root=root)
        exec(compile(ast.Module(body=[EVENTS], type_ignores=[]), str(DRIVER), 'exec'), scope)
        self.events = scope['events']

    def test_missing_file(self):
        self.assertEqual(self.events(), [])

    def test_partial_records_wait_for_lf(self):
        first = b'{"type":"ready"}\n'
        second = '{"text":"中"}'.encode('utf-8')
        for prefix in [b'', b'{', second[:-3], second]:
            with self.subTest(prefix=prefix):
                self.path.write_bytes(first + prefix)
                self.assertEqual(self.events(), [{'type': 'ready'}])
        with self.path.open('ab') as stream:
            stream.write(b'\n')
        self.assertEqual(self.events(), [{'type': 'ready'}, {'text': '中'}])

    def test_only_lf_delimits_records(self):
        row = {'text': 'first\u0085middle\u2028last\u2029'}
        self.path.write_bytes((json.dumps(row, ensure_ascii=False) + '\n').encode('utf-8'))
        self.assertEqual(self.events(), [row])

    def test_complete_corruption_still_fails(self):
        for contents in [b'{broken}\n', b'\n', b'{}\n{broken}\n']:
            with self.subTest(contents=contents):
                self.path.write_bytes(contents)
                with self.assertRaises(json.JSONDecodeError):
                    self.events()
        self.path.write_bytes(b'{"text":"\xff"}\n')
        with self.assertRaises(UnicodeDecodeError):
            self.events()


if __name__ == '__main__':
    unittest.main()
