import json


def records(path, *, final=False):
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return []
    *rows, trailing = data.split(b"\n")
    complete = [json.loads(row.decode("utf-8")) for row in rows]
    if final and trailing:
        raise ValueError("Unterminated event record after the writer stopped")
    return complete


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
