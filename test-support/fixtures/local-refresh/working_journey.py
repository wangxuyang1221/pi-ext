"""Production Working journey, using only PTY input and the remote-provider fixture boundary."""
import fcntl
import json
import os
import re
import signal
import struct
import termios
import time


def run(driver):
    wait, send, command = (driver[name] for name in ["wait", "send", "command"])
    view, settle, capture, events = (driver[name] for name in ["view", "settle", "capture", "events"])
    root, runtime, screen, checks = (driver[name] for name in ["root", "runtime", "screen", "checks"])

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
                return (match[1], tuple(screen.buffer[row][x].fg for x in range(start + 2, start + 9)), screen.buffer[row][start].fg)
        return None

    def advances(label):
        first = frame()
        assert first is not None, view()
        samples = []
        for _ in range(12):
            settle(0.08)
            value = frame()
            if value:
                samples.append(value)
        assert len({sample[0] for sample in samples}) >= 5, samples
        assert len({sample[1] for sample in samples}) >= 2, samples
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
    wait(lambda: bool(events("start")) and "Goal:" in view(), "production footer and goal row loaded")
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
    assert frame()[2] == "5efcff", frame()
    assert "Goal:" in view()
    advances("ten-frame spinner and shimmer during provider streaming")
    capture("streaming")
    send("draft-中文-abc")
    send("\x1b[D\x1b[D")
    cursor = (screen.cursor.x, screen.cursor.y)
    settle(0.6)
    assert screen.cursor.x == cursor[0] and "draft-中文-abc" in screen.display[screen.cursor.y], view()
    send("X\x1b[17~")
    assert events("editor")[-1] == "draft-中文-aXbc", events("editor")
    checks.append("draft and hardware cursor retained during real streaming and animation")
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
            assert "Goal:" in view(), view()
        if width < 40:
            assert "esc to interrupt" not in view(), view()
        capture(f"working-width-{width}")
    checks.append("32/40/100 and extreme widths retain bounded Working and footer layout")
    send("\x1b[20~")
    wait(lambda: bool(events("theme")), "theme changes through public UI")
    assert events("theme")[-1]["success"]
    advances("animation continues after theme invalidation")
    send("\x1b[20~")
    send("\x0f")
    checks.append("native tool expansion key remains usable during animation")
    cancel()

    # A real tool approval dialog, actual shell execution, and subsequent response.
    plan("tool")
    command("Run the permission tool")
    wait(lambda: "Allow Pi to run bash?" in view(), "production permissions gate")
    advances("Working continues during production permission wait")
    settle(2.2)
    assert "-- t/s" in view() and working(), view()
    capture("permission-expired-rate")
    before = len(events("agent_settled"))
    send("\r")
    wait(lambda: bool(events("tool_execution_start")), "approved tool executes through host")
    advances("Working continues during actual shell wait")
    wait(lambda: len(events("agent_settled")) > before, "tool and continuation settle")
    wait(lambda: not working(), "tool completion hides Working")
    assert (runtime / "workspace/tool-proof.txt").read_text() == "TOOL-FINISHED"
    assert "t/s" not in view(), view()
    checks.append("permission approval preserves real file side effect and footer goal row")

    plan("cancel")
    command("Cancel the running tool")
    wait(lambda: "Allow Pi to run bash?" in view(), "cancel scenario permission gate")
    send("\r")
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
    capture("finished")
    command("/quit")
    wait(lambda: driver["status"] is not None, "native quit exits without retained timer")
    assert os.waitstatus_to_exitcode(driver["status"]) == 0
