import json
from pathlib import Path
import tempfile
import unittest

from event_records import read_records


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
