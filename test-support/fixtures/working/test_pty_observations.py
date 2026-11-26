import unittest

from pty_observations import presented_cursor_frame, records
from live_event_records import read_records


class RecordsTest(unittest.TestCase):
    def test_working_compatibility_name_uses_the_shared_reader(self):
        self.assertIs(records, read_records)


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
