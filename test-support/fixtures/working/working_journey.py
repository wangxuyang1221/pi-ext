"""Production Working journey, using only PTY input and the remote-provider fixture boundary."""
import fcntl
import json
import os
import re
import signal
import struct
import termios
import time
from pathlib import Path
from wcwidth import wcswidth

from pty_observations import presented_cursor_frame


REPO_ROOT = Path(__file__).resolve().parents[3]

def tone(name):
    """Expected cell color for a codex-pi theme token, so palette changes do not desync PTY checks."""
    theme = json.loads((REPO_ROOT / "themes" / "codex-pi.json").read_text())
    value = theme["colors"].get(name, name)
    return theme["vars"].get(value, value).lstrip("#").lower()


def run(driver):
    wait, send, command = (driver[name] for name in ["wait", "send", "command"])
    view, settle, capture, events = (driver[name] for name in ["view", "settle", "capture", "events"])
    root, runtime, screen, checks = (driver[name] for name in ["root", "runtime", "screen", "checks"])

    status_label = "Status:"

    def command(text):
        send("\x15" + text)
        send("\r")

    def plan(kind):
        (root / "plan.json").write_text(json.dumps({"kind": kind, "id": str(time.monotonic_ns())}))

    def working():
        return re.search(r"[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Working \(", view()) is not None

    def frame():
        for row, line in enumerate(screen.display):
            match = re.search(r"([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]) Working", line)
            if match:
                start = match.start()
                return (
                    match[1],
                    tuple(screen.buffer[row][x].fg for x in range(start + 2, start + 9)),
                    screen.buffer[row][start].fg,
                    tuple(screen.buffer[row][x].bold for x in range(start + 2, start + 9)),
                )
        return None

    def advances(label, expect_codex_theme=True):
        first = frame()
        assert first is not None, view()
        samples = []
        for _ in range(12):
            settle(0.08)
            value = frame()
            if value:
                samples.append(value)
        assert len({sample[0] for sample in samples}) >= 5, samples
        label_colors = {sample[1] for sample in samples}
        assert len(label_colors) == 1, samples
        steady_label = next(iter(label_colors))
        assert len(set(steady_label)) == 1 and steady_label[0] != "default", samples
        assert all(sample[3] == (True,) * 7 for sample in samples), samples
        spinner_colors = {sample[2] for sample in samples}
        assert len(spinner_colors) == 1, samples
        steady_spinner = next(iter(spinner_colors))
        if expect_codex_theme:
            assert steady_label[0] == tone("text"), samples
            assert steady_spinner == tone("accent"), samples
        else:
            assert steady_label[0] != tone("text"), samples
            assert steady_spinner != tone("accent"), samples
        checks.append(label)
        driver["screens"][label] = {"text": view(), "frames": samples}

    def cancel():
        settled = len(events("agent_settled"))
        send("\x1b")
        wait(lambda: len(events("agent_settled")) > settled, "cancellation reaches actual agent_settled")
        wait(lambda: not working() and not re.search(r"(?:≈[\d.]+|--) t/s", view()), "settled releases Working and rate")

    wait(lambda: "Trust project folder?" in view() or bool(events("start")), "working CLI startup")
    if "Trust project folder?" in view():
        send("\x1b[B\x1b[B\r")
    wait(lambda: bool(events("start")) and status_label in view(), "production footer and status row loaded")
    assert not working() and "t/s" not in view(), view()
    send("\x1b[19~")
    wait(lambda: "WORKING INPUT" in view(), "idle input dialog")
    settle(0.5)
    assert not working(), view()
    send("answer\r")
    wait(lambda: bool(events("inputClosed")), "idle dialog closes without starting activity")

    plan("stream")
    command("Generate visible thinking and text")
    wait(working, "agent_start mounts production Working")
    wait(lambda: re.search(r"≈[\d.]+ t/s", view()) is not None, "real received fragments produce estimated rate")
    assert frame()[2] == tone("accent"), frame()
    assert status_label in view()
    advances("ten-frame spinner and steady bold Working label during provider streaming")
    capture("streaming")
    draft = "draft-中文-abc"
    send(draft)
    send("\x1b[D\x1b[D")

    def cursor_frame():
        return presented_cursor_frame(driver["raw"], fullscreen=driver["args"].mode == "fullscreen")

    wait(lambda: cursor_frame() is not None, "cursor restore after Left keys", seconds=2)
    before_frame = cursor_frame()
    cursor_x = screen.cursor.x
    draft_row = screen.display[screen.cursor.y]
    assert draft in draft_row, view()
    prefix = draft_row[:draft_row.index(draft)] + draft[:-2]
    assert cursor_x == wcswidth(prefix), view()

    settle(0.6)
    wait(lambda: (frame := cursor_frame()) is not None and frame > before_frame,
         "cursor restore after a newer frame", seconds=2)
    assert working() and screen.cursor.x == cursor_x and draft in screen.display[screen.cursor.y], view()
    send("X\x1b[17~")
    assert events("editor")[-1] == "draft-中文-aXbc", events("editor")
    checks.append("draft and hardware cursor retained across presented frames during streaming")
    send("\x1b[18~")
    wait(lambda: "WORKING OVERLAY" in view(), "real overlay owns focus")
    settle(0.7)
    assert "WORKING OVERLAY" in view(), view()
    capture("overlay")
    send("q")
    wait(lambda: bool(events("overlayClosed")), "overlay closes normally")
    send("\x1b[17~")
    assert events("editor")[-1] == "draft-中文-aXbc"
    send("\x15")
    send("\x1b[19~")
    wait(lambda: "WORKING INPUT" in view(), "active input dialog")
    advances("Working continues while input dialog owns focus")
    send("answer\r")
    wait(lambda: len(events("inputClosed")) == 2, "active input closes normally")

    for width in [100, 40, 32, 12, 120]:
        screen.resize(lines=40, columns=width)
        fcntl.ioctl(driver["fd"], termios.TIOCSWINSZ, struct.pack("HHHH", 40, width, 0, 0))
        os.kill(driver["pid"], signal.SIGWINCH)
        settle(0.4)
        assert "Working" in view(), view()
        if width >= 32:
            assert re.search(r"≈[\d.]+ t/s", view()), view()
            assert status_label in view(), view()
        if width < 40:
            assert "esc to interrupt" not in view(), view()
        capture(f"working-width-{width}")
    checks.append("32/40/100 and extreme widths retain bounded Working and footer layout")
    send("\x1b[20~")
    wait(lambda: bool(events("theme")), "theme changes through public UI")
    assert events("theme")[-1]["success"]
    advances("animation continues after theme invalidation", expect_codex_theme=False)
    send("\x1b[20~")
    send("\x0f")
    checks.append("native tool expansion key remains usable during animation")
    cancel()

    # Actual shell execution, and subsequent response.
    plan("tool")
    command("Run the shell tool")
    before = len(events("agent_settled"))
    wait(lambda: bool(events("tool_execution_start")), "shell tool executes through host")
    advances("Working continues during actual shell wait")
    settle(2.2)
    assert "-- t/s" in view() and working(), view()
    capture("tool-expired-rate")
    wait(lambda: len(events("agent_settled")) > before, "tool and continuation settle")
    wait(lambda: not working(), "tool completion hides Working")
    assert (runtime / "workspace/tool-proof.txt").read_text() == "TOOL-FINISHED"
    assert "t/s" not in view(), view()
    checks.append("host tool preserves real file side effect and neutral status row")

    plan("cancel")
    command("Cancel the running tool")
    wait(lambda: any("CANCEL-TOOL-ENTERED" in json.dumps(event) for event in events("tool_execution_update")), "cancel hits executing shell")
    cancel()
    assert not (runtime / "workspace/should-not-exist.txt").exists()
    checks.append("real Escape cancellation stops shell side effect before settlement")

    plan("retry")
    before = len(events("agent_settled"))
    command("Retry the controlled rate limit")
    wait(lambda: "Retrying" in view() or "Retry" in view(), "host retries provider rate limit")
    advances("Working continues across agent_end and retry backoff")
    wait(lambda: len(events("agent_settled")) > before, "retry continuation settles")
    assert any(event["kind"] == "retry" and event["attempt"] == 2 for event in events("request"))
    wait(lambda: not working(), "retry settlement hides Working")

    plan("compact")
    before = len(events("agent_settled"))
    compactions = len(events("compaction"))
    command("Recover from context overflow")
    wait(lambda: len(events("compaction")) > compactions, "host overflow enters automatic compaction")
    assert events("compaction")[-1] == {"reason": "overflow", "willRetry": True}, events("compaction")
    advances("Working continues during actual automatic compaction hook")
    wait(lambda: len(events("agent_settled")) > before, "automatic compaction and recovery settle")
    assert events("session_compact"), events("session_compact_failed")
    wait(lambda: not working(), "compaction settlement hides Working")

    plan("error")
    before = len(events("agent_settled"))
    command("Return a final nonretryable error")
    wait(lambda: len(events("agent_settled")) > before, "final error settles")
    wait(lambda: not working() and "t/s" not in view(), "final error releases dynamic UI")

    # Mode changes while the task is active use the host settings menu.
    plan("stream")
    command("Stream across renderer changes")
    wait(working, "second task starts")
    for expected in [("fullscreen" if driver["args"].mode == "regular" else "regular"), driver["args"].mode]:
        command("/settings")
        send("TUI mode")
        wait(lambda: "TUI mode" in view(), "native mode selector")
        send("\r")
        send("\x1b")
        settle(0.5)
        assert json.loads((runtime / "agent/settings.json").read_text())["tuiMode"] == expected
        advances(f"Working survives renderer switch to {expected}")
    cancel()
    starts = len(events("start"))
    command("/new")
    wait(lambda: len(events("start")) > starts, "real new session")
    assert not working() and "t/s" not in view()
    starts = len(events("start"))
    command("/fixture-reload")
    wait(lambda: len(events("start")) > starts, "real extension reload")
    assert not working() and "t/s" not in view()
    plan("retry")
    before = len(events("agent_settled"))
    command("Task after reload")
    wait(working, "new timer after reload")
    wait(lambda: len(events("agent_settled")) > before, "reloaded task settles")
    wait(lambda: not working() and not re.search(r"(?:≈[\d.]+|--) t/s", view()), "reloaded settlement removes Working and rate from the screen")
    capture("finished")
    command("/quit")
    wait(lambda: driver["status"] is not None, "native quit exits without retained timer")
    assert os.waitstatus_to_exitcode(driver["status"]) == 0
