import unittest

from pty_observations import Frame, STATUS_TEXT, SYNC_END, SYNC_START, presented_cursor_frame, presented_frame_after, records, working_slots
from live_event_records import read_records


class RecordsTest(unittest.TestCase):
    def test_working_compatibility_name_uses_the_shared_reader(self):
        self.assertIs(records, read_records)


class WorkingSlotsTest(unittest.TestCase):
    def rows(self, *, working="", footer="faux-1", fullscreen=True):
        body = [" ⠏ Working (99s) -- t/s", "-- t/s".rjust(59) + " ", STATUS_TEXT]
        composer = [working, "", "› Ask Pi to do anything", "/ for commands".rjust(60)]
        rows = body + composer + [footer, STATUS_TEXT]
        if not fullscreen:
            rows += [""] * 3
        return [line.ljust(60) for line in rows]

    def test_transcript_imitating_the_spinner_metric_and_status_does_not_match(self):
        for fullscreen in (True, False):
            with self.subTest(fullscreen=fullscreen):
                layout = working_slots(self.rows(fullscreen=fullscreen), 60, fullscreen=fullscreen)
                self.assertEqual(layout.status_row, 8)
                self.assertEqual(layout.working_text, "")
                self.assertIsNone(layout.spinner)
                self.assertIsNone(layout.metric)

    def test_detects_only_working_and_right_aligned_footer_slots(self):
        metric = "≈218 t/s"
        footer = " faux-1".ljust(59 - len(metric)) + metric + " "
        rows = self.rows(working=" ⠙ Working (1s)", footer=footer)
        layout = working_slots(rows, 60, fullscreen=True)
        self.assertEqual(layout.spinner, "⠙")
        self.assertEqual(layout.metric, (metric, 59 - len(metric)))
        rows[3] = "Transcript: ⠙ Working (1s)".ljust(60)
        rows[7] = " faux-1 -- t/s".ljust(60)
        layout = working_slots(rows, 60, fullscreen=True)
        self.assertIsNone(layout.spinner)
        self.assertIsNone(layout.metric)

    def test_fullscreen_requires_status_at_bottom_of_the_viewport(self):
        self.assertIsNone(working_slots(self.rows(fullscreen=False), 60, fullscreen=True))


class PresentedFrameTest(unittest.TestCase):
    def test_old_frame_is_rejected_when_action_happens_after_it(self):
        old = SYNC_START + b"stale target content" + SYNC_END
        self.assertIsNone(presented_frame_after(old, len(old)))
        next_frame = SYNC_START + b"current target content" + SYNC_END
        self.assertEqual(presented_frame_after(old + next_frame, len(old)), Frame(len(old), len(old + next_frame)))

    def test_requires_complete_frame_that_opens_after_event_observation(self):
        started = SYNC_START + b"before event"
        offset = len(started)
        new_frame = SYNC_START + b"after event"
        self.assertIsNone(presented_frame_after(started + SYNC_END, offset))
        for tail in (b"", SYNC_END[:-1]):
            raw = started + SYNC_END + new_frame + tail
            self.assertIsNone(presented_frame_after(raw, offset))
        raw = started + SYNC_END + new_frame + SYNC_END
        self.assertEqual(presented_frame_after(raw, offset), Frame(offset + len(SYNC_END), len(raw)))


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
