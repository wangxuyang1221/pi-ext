from dataclasses import dataclass
from pathlib import Path
import re
import sys
from wcwidth import wcswidth

SHARED_TERMINAL = Path(__file__).resolve().parents[3] / "test-support/terminal"
sys.path.insert(0, str(SHARED_TERMINAL))
from live_event_records import read_records as records


SYNC_START = b"\x1b[?2026h"
SYNC_END = b"\x1b[?2026l"
STATUS_TEXT = " Status: active | Keep the second footer row intact"
WORKING = re.compile(r"^ ([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]) Working \(")
RATE = r"≈\d+(?:\.\d+)?[kM]? t/s"
METRIC = re.compile(rf"(?<= )(?:{RATE}|≈(?:<1|\d+(?:\.\d+)?[kM]?) tok|-- t/s) $")


@dataclass(frozen=True)
class Frame:
    start: int
    end: int


def presented_frame_after(raw, offset):
    """Find a completed synchronized frame that opened at or after the evidence boundary."""
    start, end = raw.rfind(SYNC_START), raw.rfind(SYNC_END)
    if offset <= start < end:
        return Frame(start, end + len(SYNC_END))
    return None


@dataclass(frozen=True)
class WorkingSlots:
    working_row: int
    working_text: str
    footer_row: int
    footer_text: str
    status_row: int
    status_text: str

    @property
    def spinner(self):
        match = WORKING.match(self.working_text)
        return match[1] if match else None

    @property
    def metric(self):
        match = METRIC.search(self.footer_text)
        if not match:
            return None
        label = match[0].rstrip()
        if wcswidth(label) > 10:
            return None
        return label, wcswidth(self.footer_text[:match.start()])


def working_slots(lines, columns, *, fullscreen, input_dialog=False):
    """Locate the Working row from the visible composer and the footer's status line."""
    if len(lines) < 6:
        return None
    status_row = len(lines) - 1
    if not fullscreen:
        while status_row >= 5 and not lines[status_row].strip():
            status_row -= 1
    status = STATUS_TEXT[:columns].rstrip()
    if lines[status_row].rstrip() != status or status_row < 5:
        return None

    footer_row = status_row - 1
    if input_dialog:
        # The input dialog replaces the composer between two full-width borders.
        close_border = footer_row - 1
        border = "─" * columns
        if lines[close_border] != border:
            return None
        opening = next((row for row in range(close_border - 1, 0, -1) if lines[row] == border), None)
        if opening is None or not opening + 2 < close_border or lines[opening + 2].strip() != "WORKING INPUT":
            return None
        working_row = opening - 1
    else:
        # The journey uses a single-line composer with an auxiliary row below it.
        editor_row = footer_row - 2
        if not lines[editor_row].startswith("›") or lines[editor_row - 1].strip():
            return None
        working_row = editor_row - 2
    return WorkingSlots(working_row, lines[working_row].rstrip(), footer_row, lines[footer_row], status_row, status)


def presented_cursor_frame(raw, *, fullscreen):
    """Return the latest presented frame's closing offset only once its cursor is visible."""
    start = raw.rfind(SYNC_START)
    end = raw.rfind(SYNC_END)
    show = raw.rfind(b"\x1b[?25h")
    if not 0 <= start < end or show <= raw.rfind(b"\x1b[?25l"):
        return None
    # Pi's fullscreen renderer restores inside the frame; the regular renderer restores after it.
    restored = start < show < end if fullscreen else show > end
    return end if restored else None
