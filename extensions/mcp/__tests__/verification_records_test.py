"""Deterministic coverage of append-only verification JSONL reads."""
import json
from pathlib import Path
import tempfile
import unittest

from verification_records import read_records


class VerificationRecordsTests(unittest.TestCase):
    def test_missing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(read_records(Path(directory) / 'events.jsonl'), [])

    def test_partial_record_is_deferred_until_line_feed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'events.jsonl'
            first = b'{"type":"ready"}\n'
            second = '{"text":"中"}'.encode('utf-8')
            for prefix in [b'', b'{', second[:-3], second]:
                path.write_bytes(first + prefix)
                self.assertEqual(read_records(path), [{'type': 'ready'}])
            with path.open('ab') as stream:
                stream.write(b'\n')
            self.assertEqual(read_records(path), [{'type': 'ready'}, {'text': '中'}])

    def test_only_lf_delimits_records(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'events.jsonl'
            row = {'text': 'first\u0085middle\u2028last\u2029'}
            path.write_bytes((json.dumps(row, ensure_ascii=False) + '\n').encode('utf-8'))
            self.assertEqual(read_records(path), [row])

    def test_complete_corruption_is_not_hidden(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'events.jsonl'
            for contents in [b'{broken}\n', b'\n', b'{}\n{broken}\n']:
                path.write_bytes(contents)
                with self.assertRaises(json.JSONDecodeError):
                    read_records(path)
            path.write_bytes(b'{"text":"\xff"}\n')
            with self.assertRaises(UnicodeDecodeError):
                read_records(path)


if __name__ == '__main__':
    unittest.main()
