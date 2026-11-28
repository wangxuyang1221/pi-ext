import ast
import json
from pathlib import Path
import tempfile
import unittest

from event_records import read_records


SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parents[3]
WORKING_FIXTURE = REPO / "test-support/fixtures/working"


class EventRecordsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "events.jsonl"

    def test_poll_only_reads_complete_lf_records(self):
        self.assertEqual(read_records(self.path), [])
        complete = b'{"type":"ready"}\n'
        followup = '{"value":"中\u2028文"}'.encode("utf-8")
        for offset in range(1, len(followup) + 1):
            with self.subTest(offset=offset):
                self.path.write_bytes(complete + followup[:offset])
                self.assertEqual(read_records(self.path), [{"type": "ready"}])
        with self.path.open("ab") as file:
            file.write(b"\n")
        self.assertEqual(read_records(self.path, final=True), [{"type": "ready"}, {"value": "中\u2028文"}])

    def test_complete_malformed_records_fail_even_while_polling(self):
        self.path.write_bytes(b'{}\n{"x":\n')
        with self.assertRaises(json.JSONDecodeError):
            read_records(self.path)
        self.path.write_bytes(b'{"x":"\xff"}\n')
        with self.assertRaises(UnicodeDecodeError):
            read_records(self.path)

    def test_final_read_refuses_unterminated_record_even_if_valid_json(self):
        self.path.write_bytes(b'{}')
        self.assertEqual(read_records(self.path), [])
        with self.assertRaisesRegex(ValueError, "Unterminated event record"):
            read_records(self.path, final=True)

    def test_live_reader_does_not_keep_state_between_snapshots(self):
        self.path.write_bytes(b'{"type":"first"}\r\n{"type":"partial"}')
        self.assertEqual(read_records(self.path), [{"type": "first"}])
        self.path.write_bytes(b'{"type":"after-restart"}\n')
        self.assertEqual(read_records(self.path, final=True), [{"type": "after-restart"}])
        self.path.unlink()
        self.assertEqual(read_records(self.path, final=True), [])

    def test_skill_compatibility_name_uses_the_shared_reader(self):
        from live_event_records import read_records as shared_reader

        self.assertIs(read_records, shared_reader)

    def test_live_event_ledgers_are_not_read_directly(self):
        def event_path(node):
            return any(isinstance(part, ast.Constant) and part.value == "events.jsonl" for part in ast.walk(node))

        paths = [
            *SCRIPTS.glob("*.py"),
            REPO / "test-support/terminal/pty_journey.py",
            *WORKING_FIXTURE.glob("*.py"),
            REPO / "scripts/working-pty.py",
        ]
        for path in paths:
            if path.name in {"test_event_records.py", "test_pty_observations.py"}:
                continue
            with self.subTest(consumer=path.name):
                tree = ast.parse(path.read_text())
                event_paths = {
                    target.id
                    for node in ast.walk(tree) if isinstance(node, ast.Assign) and event_path(node.value)
                    for target in node.targets if isinstance(target, ast.Name)
                }
                for call in ast.walk(tree):
                    if not isinstance(call, ast.Call):
                        continue
                    receiver = None
                    if isinstance(call.func, ast.Attribute) and call.func.attr in {"read_text", "read_bytes", "open"}:
                        receiver = call.func.value
                    elif isinstance(call.func, ast.Name) and call.func.id == "open" and call.args:
                        receiver = call.args[0]
                    if receiver is None:
                        continue
                    self.assertFalse(event_path(receiver) or isinstance(receiver, ast.Name) and receiver.id in event_paths,
                                     f"{path.name}:{call.lineno} must read live event records with read_records")
