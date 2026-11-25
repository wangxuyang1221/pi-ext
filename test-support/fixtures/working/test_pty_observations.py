import json
from pathlib import Path
import tempfile
import unittest

from pty_observations import presented_cursor_frame, records


class RecordsTest(unittest.TestCase):
    def test_uncommitted_json_and_utf8_wait_for_lf(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            self.assertEqual(records(path), [])
            first = b'{"type":"ready"}\n'
            second = '{"data":"中"}'.encode()
            for prefix in (b'{', second[:-3], second):
                with self.subTest(prefix=prefix):
                    path.write_bytes(first + prefix)
                    self.assertEqual(records(path), [{"type": "ready"}])
            with path.open("ab") as stream:
                stream.write(b"\n")
            self.assertEqual(records(path), [{"type": "ready"}, {"data": "中"}])

    def test_final_read_rejects_even_valid_unterminated_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            path.write_bytes(b'{"type":"ready"}\n{}')
            self.assertEqual(records(path), [{"type": "ready"}])
            with self.assertRaisesRegex(ValueError, "Unterminated event record"):
                records(path, final=True)
            with path.open("ab") as stream:
                stream.write(b"\n")
            self.assertEqual(records(path, final=True), [{"type": "ready"}, {}])

    def test_complete_corrupt_records_remain_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            path.write_bytes(b'{}\n{"data":\n')
            with self.assertRaises(json.JSONDecodeError):
                records(path)
            path.write_bytes(b'{"data":"\xff"}\n')
            with self.assertRaises(UnicodeDecodeError):
                records(path)


class CursorFrameTest(unittest.TestCase):
    def test_regular_requires_post_frame_cursor_restore(self):
        start, end = b"\x1b[?2026h", b"\x1b[?2026l"
        first = start + b"style" + end + b"\x1b[2A\x1b[14G\x1b[?25h"
        self.assertIsNotNone(presented_cursor_frame(first, fullscreen=False))
        frame = first + start + b"next" + end
        restore = b"\x1b[3A\x1b[14G\x1b[?25h"
        for prefix in (b"", restore[:4], restore[:-1]):
            with self.subTest(prefix=prefix):
                self.assertIsNone(presented_cursor_frame(frame + prefix, fullscreen=False))
        self.assertEqual(presented_cursor_frame(frame + restore, fullscreen=False), len(frame) - len(end))

    def test_fullscreen_requires_in_frame_cursor_restore_and_close(self):
        start, end = b"\x1b[?2026h", b"\x1b[?2026l"
        restore = b"\x1b[34;14H\x1b[?25h"
        first = start + restore + end
        self.assertIsNotNone(presented_cursor_frame(first, fullscreen=True))
        self.assertIsNone(presented_cursor_frame(first + start + end, fullscreen=True))
        frame = first + start + restore
        self.assertIsNone(presented_cursor_frame(frame + end[:-1], fullscreen=True))
        self.assertEqual(presented_cursor_frame(frame + end, fullscreen=True), len(frame))
        self.assertIsNone(presented_cursor_frame(frame + b"\x1b[?25l" + end, fullscreen=True))


if __name__ == "__main__":
    unittest.main()
