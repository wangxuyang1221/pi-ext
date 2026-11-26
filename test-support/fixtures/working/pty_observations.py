from pathlib import Path
import sys

SHARED_TERMINAL = Path(__file__).resolve().parents[3] / "test-support/terminal"
sys.path.insert(0, str(SHARED_TERMINAL))
from live_event_records import read_records as records


def presented_cursor_frame(raw, *, fullscreen):
    """Return the latest presented frame's closing offset only once its cursor is visible."""
    start = raw.rfind(b"\x1b[?2026h")
    end = raw.rfind(b"\x1b[?2026l")
    show = raw.rfind(b"\x1b[?25h")
    if not 0 <= start < end or show <= raw.rfind(b"\x1b[?25l"):
        return None
    # Pi's fullscreen renderer restores inside the frame; the regular renderer restores after it.
    restored = start < show < end if fullscreen else show > end
    return end if restored else None
