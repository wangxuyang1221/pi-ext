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

from pty_observations import RATE, event_marker_end, presented_cursor_frame, presented_frame_after, working_slots


REPO_ROOT = Path(__file__).resolve().parents[3]

def tone(name):
    """Expected cell color for a codex-pi theme token, so palette changes do not desync PTY checks."""
    theme = json.loads((REPO_ROOT / "themes" / "codex-pi.json").read_text())
    value = theme["colors"].get(name, name)
    return theme["vars"].get(value, value).lstrip("#").lower()


def run(driver):
    wait, send = (driver[name] for name in ["wait", "send"])
    view, settle, capture, events = (driver[name] for name in ["view", "settle", "capture", "events"])
    root, runtime, screen, checks = (driver[name] for name in ["root", "runtime", "screen", "checks"])

    mode = driver["args"].mode
    active_color, idle_color = tone("muted"), tone("dim")

    def slots(*, dialog=False):
        return working_slots(screen.display, screen.columns, fullscreen=mode == "fullscreen", input_dialog=dialog)

    def footer_metric():
        layout = slots()
        if layout is None or layout.metric is None:
            return ""
        label, column = layout.metric
        assert screen.columns - 11 <= column and column + wcswidth(label) == screen.columns - 1, layout
        color = idle_color if label == "-- t/s" else active_color
        assert all(screen.buffer[layout.footer_row][x].fg == color
                   for x in range(column, column + wcswidth(label))), (layout, color)
        return label

    def command(text):
        send("\x15" + text)
        return send("\r")

    def plan(kind):
        (root / "plan.json").write_text(json.dumps({"kind": kind, "id": str(time.monotonic_ns())}))

    def working(*, dialog=False):
        layout = slots(dialog=dialog)
        return layout is not None and layout.spinner is not None

    def idle_footer(*, dialog=False):
        layout = slots(dialog=dialog)
        return layout is not None and layout.idle

    def find_event(after, kind, predicate=lambda _: True):
        return next((event for event in driver["lifecycle"][after["eventCount"]:]
                     if event["type"] == kind and predicate(event["data"])), None)

    def wait_surface(predicate, label, after, *, kind=None, matches=lambda _: True, dialog=False, seconds=20, name=None):
        event = None
        marker_end = None

        def ready():
            nonlocal event, marker_end
            offset = after["rawBytes"]
            if kind is not None:
                event = find_event(after, kind, matches)
                if event is None:
                    return False
                marker_end = event_marker_end(driver["raw"], event["sequence"], offset)
                if marker_end is None:
                    return False
                offset = marker_end
            return presented_frame_after(driver["raw"], offset) is not None and predicate()

        wait(ready, label, seconds=seconds)
        name = name or label
        capture(name)
        layout = slots(dialog=dialog)
        driver["screens"][name].update(
            after=after, event=event, eventMarkerEnd=marker_end,
            slots={"workingRow": layout.working_row, "working": layout.working_text,
                   "footerRow": layout.footer_row, "footer": layout.footer_text,
                   "statusRow": layout.status_row, "status": layout.status_text},
        )
        return event

    def advances(label, expect_codex_theme=True, *, dialog=False):
        boundary = len(driver["raw"])
        samples = []
        for _ in range(12):
            settle(0.08)
            presented = presented_frame_after(driver["raw"], boundary)
            layout = slots(dialog=dialog)
            if presented and layout and layout.spinner:
                cells = screen.buffer[layout.working_row]
                samples.append((
                    layout.spinner, tuple(cells[x].fg for x in range(3, 10)), cells[1].fg,
                    tuple(cells[x].bold for x in range(3, 10)), presented.end,
                ))
                boundary = presented.end
        assert len({sample[0] for sample in samples}) >= 5, (samples, view())
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

    def wait_idle(label, after, *, aborted=False, name=None):
        return wait_surface(idle_footer, label, after, kind="agent_settled",
                            matches=lambda event: event["aborted"] is aborted, name=name)

    def cancel(name, *, transcript=None):
        action = send("\x1b")
        settled = wait_idle("Escape aborts the task and a new frame clears Working and rate", action, aborted=True, name=name)
        ended = find_event(action, "agent_end")
        assert ended is not None and ended["sequence"] < settled["sequence"], settled
        if transcript is not None:
            assert transcript in view(), view()
        return action, settled

    startup = {"rawBytes": 0, "eventCount": 0}
    wait(lambda: "Trust project folder?" in view() or bool(events("start")), "working CLI startup")
    if "Trust project folder?" in view():
        send("\x1b[B\x1b[B\r")
    session = wait_surface(idle_footer, "startup presents the production footer without Working", startup,
                           kind="start", matches=lambda event: event["reason"] == "startup")
    action = send("\x1b[19~")
    wait_surface(lambda: idle_footer(dialog=True), "idle input dialog presents without Working", action, dialog=True)
    settle(0.5)
    assert idle_footer(dialog=True) and find_event(action, "agent_start") is None, view()
    send("answer\r")
    wait(lambda: bool(events("inputClosed")), "idle dialog closes without starting activity")

    plan("stream")
    action = command("Generate visible thinking and text")
    wait_surface(working, "agent_start mounts production Working", action, kind="agent_start")
    wait_surface(lambda: re.fullmatch(RATE, footer_metric()), "real received fragments produce estimated rate",
                 action, kind="request", matches=lambda event: event["kind"] == "stream")
    advances("ten-frame spinner and steady bold Working label during provider streaming")
    capture("streaming")
    draft = "draft-中文-abc"
    send(draft)
    left = send("\x1b[D\x1b[D")

    def cursor_frame():
        if presented_frame_after(driver["raw"], left["rawBytes"]):
            return presented_cursor_frame(driver["raw"], fullscreen=mode == "fullscreen")
        return None

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
    action = send("\x1b[19~")
    wait_surface(lambda: working(dialog=True), "active input dialog presents over the active Working row",
                 action, dialog=True)
    advances("Working continues while input dialog owns focus", dialog=True)
    send("answer\r")
    wait(lambda: len(events("inputClosed")) == 2, "active input closes normally")

    for width in [100, 40, 32, 12, 120]:
        action = {"resizeColumns": width, "rawBytes": len(driver["raw"]), "eventCount": len(driver["lifecycle"])}
        driver["actions"].append(action)
        screen.resize(lines=40, columns=width)
        fcntl.ioctl(driver["fd"], termios.TIOCSWINSZ, struct.pack("HHHH", 40, width, 0, 0))
        os.kill(driver["pid"], signal.SIGWINCH)
        settle(0.4)
        wait_surface(lambda: working() and re.fullmatch(RATE, footer_metric()),
                     f"resized {width}-column frame retains Working and rate", action, name=f"working-width-{width}")
        working_text = slots().working_text
        if width >= 32:
            assert re.search(r" Working \(\d+s\b", working_text), view()
        if width < 40:
            assert "esc to interrupt" not in working_text, view()
    checks.append("32/40/100 and extreme widths retain bounded Working and footer layout")
    action = send("\x1b[20~")
    wait_surface(working, "theme changes through public UI", action, kind="theme",
                 matches=lambda event: event["success"])
    advances("animation continues after theme invalidation", expect_codex_theme=False)
    send("\x1b[20~")
    send("\x0f")
    checks.append("native tool expansion key remains usable during animation")
    cancel("cancel-stream")

    # Actual shell execution, and subsequent response.
    plan("tool")
    action = command("Run the shell tool")
    wait_surface(lambda: working() and footer_metric() == "≈400 tok",
                 "first 500 Chinese characters show the received amount", action, kind="toolTextPacket",
                 name="tool-warmup")
    first_packet = find_event(action, "toolTextPacket")
    second_packet_boundary = {**action, "eventCount": first_packet["sequence"] + 1}
    wait_surface(lambda: working() and re.fullmatch(RATE, footer_metric()),
                 "second Chinese packet shows a measured rate", second_packet_boundary,
                 kind="toolTextPacket", seconds=1.6, name="tool-stream-rate")
    first, second = events("toolTextPacket")
    assert first["size"] == second["size"] == 500, (first, second)
    span_ms = second["receivedAt"] - first["receivedAt"]
    expected_rate = 400_000 / span_ms
    label = footer_metric()
    assert 240 <= span_ms < 2000 and re.fullmatch(r"≈\d+ t/s", label), (span_ms, label)
    observed_rate = int(label[1:].split()[0])
    assert abs(observed_rate - expected_rate) <= expected_rate * 0.05, (label, expected_rate, span_ms)
    driver["screens"]["tool-stream-rate"].update(packetSpanMs=span_ms, expectedRate=expected_rate)
    wait(lambda: find_event(action, "tool_execution_start") is not None, "shell tool executes through host")
    tool_started = time.monotonic()
    started = wait_surface(lambda: working() and footer_metric() == "-- t/s",
                           "tool start presents the dim placeholder", action, kind="tool_execution_start",
                           seconds=0.65, name="tool-start-rate")
    driver["screens"]["tool-start-rate"]["msAfterObservedToolStart"] = (time.monotonic() - tool_started) * 1000
    advances("Working continues during actual shell wait")
    assert find_event(action, "tool_execution_end") is None and footer_metric() == "-- t/s", view()
    settled = wait_idle("tool and continuation settle before the neutral footer appears", action, name="tool-settled")
    ended = find_event(action, "tool_execution_end",
                       lambda event: event["toolCallId"] == started["data"]["toolCallId"] and not event["isError"])
    assert ended is not None and started["sequence"] < ended["sequence"] < settled["sequence"], settled
    assert (runtime / "workspace/tool-proof.txt").read_text() == "TOOL-FINISHED"
    checks.append("host tool preserves real file side effect and neutral status row")

    plan("cancel")
    transcript = "⠋ Working (99s) -- t/s"
    action = command(f"Cancel the running tool {transcript}")
    entered = wait_surface(lambda: working() and footer_metric() == "-- t/s" and transcript in view(),
                           "cancel hits executing shell while the user transcript imitates Working and rate",
                           action, kind="tool_execution_update",
                           matches=lambda event: any(item.get("text") == "CANCEL-TOOL-ENTERED"
                                                     for item in event["partialResult"]["content"]),
                           name="cancel-tool-running")
    action, settled = cancel("cancel-tool-settled", transcript=transcript)
    aborted_tool = find_event(action, "tool_execution_end",
                              lambda event: event["isError"] and event["toolCallId"] == entered["data"]["toolCallId"])
    assert aborted_tool is not None and aborted_tool["sequence"] < settled["sequence"], events("tool_execution_end")
    assert not (runtime / "workspace/should-not-exist.txt").exists()
    checks.append("real Escape cancellation stops shell side effect before settlement")

    plan("retry")
    action = command("Retry the controlled rate limit")
    wait_surface(working, "host keeps Working through a retryable agent_end", action, kind="agent_end")
    advances("Working continues across agent_end and retry backoff")
    wait_idle("retry settlement hides Working and rate", action, name="retry-settled")
    assert find_event(action, "request", lambda event: event["kind"] == "retry" and event["attempt"] == 2)

    plan("compact")
    action = command("Recover from context overflow")
    wait_surface(working, "host overflow enters automatic compaction", action, kind="compaction",
                 matches=lambda event: event == {"reason": "overflow", "willRetry": True})
    advances("Working continues during actual automatic compaction hook")
    wait_idle("compaction settlement hides Working and rate", action, name="compaction-settled")
    assert find_event(action, "session_compact"), events("session_compact_failed")

    plan("error")
    action = command("Return a final nonretryable error")
    wait_idle("final error releases dynamic UI", action, name="error-settled")
    assert find_event(action, "agent_end"), events("agent_end")

    # Mode changes while the task is active use the host settings menu.
    plan("stream")
    action = command("Stream across renderer changes")
    wait_surface(working, "second task starts", action, kind="agent_start")
    for expected in [("fullscreen" if driver["args"].mode == "regular" else "regular"), driver["args"].mode]:
        command("/settings")
        send("TUI mode")
        wait(lambda: "TUI mode" in view(), "native mode selector")
        send("\r")
        action = send("\x1b")
        mode = expected
        settle(0.5)
        assert json.loads((runtime / "agent/settings.json").read_text())["tuiMode"] == expected
        wait_surface(working, f"{expected} presents Working after leaving settings", action)
        advances(f"Working survives renderer switch to {expected}")
    cancel("cancel-after-mode-switch")
    action = command("/new")
    new_session = wait_surface(idle_footer, "new session restores the neutral footer", action, kind="start",
                               matches=lambda event: event["reason"] == "new", name="new-session")
    assert new_session["data"]["session"] != session["data"]["session"], new_session
    assert find_event(action, "session_shutdown", lambda event: event["reason"] == "new")
    action = command("/fixture-reload")
    reloaded = wait_surface(idle_footer, "extension reload restores the neutral footer", action, kind="start",
                            matches=lambda event: event["reason"] == "reload", name="reload")
    assert reloaded["data"]["session"] == new_session["data"]["session"], reloaded
    assert find_event(action, "session_shutdown", lambda event: event["reason"] == "reload")
    plan("retry")
    action = command("Task after reload")
    wait_surface(working, "new timer after reload", action, kind="agent_start")
    wait_idle("reloaded settlement removes Working and rate", action, name="finished")
    action = command("/quit")
    wait(lambda: driver["status"] is not None, "native quit exits without retained timer")
    assert os.waitstatus_to_exitcode(driver["status"]) == 0
    assert find_event(action, "session_shutdown", lambda event: event["reason"] == "quit")
