"""Drive actual Pi InteractiveMode through a PTY, without model/network access."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import signal
import sys
import time

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
from signal_support import install
install(root, globals())
if (root / "events.jsonl").exists():
    raise FileExistsError("Use a fresh evidence directory for each probe run")
package_root = str(Path(sys.argv[2]).resolve())
pid, fd = pty.fork()
if pid == 0:
    os.environ["GOAL_PROBE_ROOT"] = str(root)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("node", ["node", "extensions/goal/__tests__/acceptance-tui.mjs", package_root])

(root / "pid.txt").write_text(str(pid))
sent_probe = False
sent_exit = False
sent_followup = False
sent_dialog_escape = False
sent_resume = False
sent_recovery = False
sent_explicit = False
scenario = os.environ.get("GOAL_TUI_SCENARIO", "retry-c12")
status = None
try:
    with (root / "terminal.ansi").open("wb") as transcript:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], 0.05)
            if ready:
                try:
                    data = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b""
                transcript.write(data)
                transcript.flush()
            events_file = root / "events.jsonl"
            events = events_file.read_text() if events_file.exists() else ""
            if '"event":"ready"' in events and not sent_probe:
                # Allow the app to bind the editor after its session_start event.
                time.sleep(0.3)
                os.write(fd, b"/goal resume\r" if scenario in ("retry-c12", "stream-interrupt", "stream-pause", "tool-interrupt", "loop-pause", "edit-cancel", "replace-cancel") or scenario.startswith("compact") else b"/goal Exercise actual interruption\r")
                sent_probe = True
            if ('"event":"auto_retry_start"' in events or '"event":"model_streaming"' in events or (scenario == "compact-cancel" and '"event":"compaction_start"' in events)) and not sent_followup:
                time.sleep(0.15)
                if scenario in ("edit-cancel", "replace-cancel"):
                    os.write(fd, b"/goal edit\r" if scenario == "edit-cancel" else b"/goal Replacement objective\r")
                else:
                    os.write(fd, b"/goal pause\r" if scenario == "stream-pause" else b"/probe-dialog\r" if scenario == "retry-dialog" else b"\x1b")
                sent_followup = True
            if '"event":"input_window"' in events and not sent_followup:
                os.write(fd, b"USER_INPUT_PRESERVED\r" if scenario == "input-steer" else b"USER_INPUT_PRESERVED\x1b\r")
                sent_followup = True
            if '"event":"waiting_for_typed_followup"' in events and not sent_followup:
                os.write(fd, b"TYPED_FOLLOWUP_MUST_SURVIVE\x1b\r")
                sent_followup = True
            if scenario in ("edit-cancel", "replace-cancel") and sent_followup and not sent_dialog_escape:
                title = "Edit goal" if scenario == "edit-cancel" else "Replace current goal?"
                if title in (root / "terminal.ansi").read_text(errors="replace"):
                    os.write(fd, b"\x1b")
                    sent_dialog_escape = True
            if '"event":"dialog_open"' in events and not sent_dialog_escape:
                time.sleep(0.2)
                os.write(fd, b"\x1b")
                sent_dialog_escape = True
            if '"event":"settled"' in events and not sent_exit:
                if scenario in ("compact-failure", "compact-cancel", "compact-manual"):
                    if not sent_recovery:
                        time.sleep(0.2)
                        os.write(fd, b"/compact\r" if scenario == "compact-manual" else b"Explicit user input after compaction failure\r")
                        sent_recovery = True
                    elif scenario == "compact-manual" and not sent_explicit and '"event":"compact_succeeded","reason":"manual"' in events:
                        time.sleep(0.2)
                        os.write(fd, b"Explicit user input after manual compaction\r")
                        sent_explicit = True
                    elif '"settledCount":2' in events and not sent_resume:
                        time.sleep(0.2)
                        os.write(fd, b"/goal resume\r")
                        sent_resume = True
                    elif '"settledCount":3' in events:
                        os.write(fd, b"\x15/probe-exit\r")
                        sent_exit = True
                elif scenario in ("retry-c12", "stream-interrupt", "stream-pause", "tool-interrupt", "loop-pause") and not sent_resume:
                    time.sleep(0.2)
                    os.write(fd, b"\x15/goal resume\r")
                    sent_resume = True
                elif scenario not in ("retry-c12", "stream-interrupt", "stream-pause", "tool-interrupt", "loop-pause") or '"settledCount":2' in events:
                    os.write(fd, b"\x15/probe-exit\r")
                    sent_exit = True
            waited, child_status = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = child_status
                break
        if status is None:
            raise TimeoutError("TUI probe did not exit within 30 seconds")
    assert os.waitstatus_to_exitcode(status) == 0, f"TUI child failed: {status}"
    records = [json.loads(line) for line in (root / "events.jsonl").read_text().splitlines()]
    result = next(record for record in records if record["event"] == "result")
    print(json.dumps({"pid": pid, "exited": True, "result": result}, ensure_ascii=False, indent=2))
    if scenario == "c11":
        assert result["calls"] == 1, "Invalid owned continuation must not issue a model request"
        assert result["goal"]["status"] == "paused"
        assert result["goal"]["goalId"] == result["savedGoalId"]
        assert "TYPED_FOLLOWUP_MUST_SURVIVE" in result["editorText"]
        assert any(record.get("text") == "TYPED_FOLLOWUP_MUST_SURVIVE" and record.get("source") == "interactive" for record in records)
        assert "Saved assistant history" in json.dumps(result["messages"])
        assert "OTHER_EXTENSION_ACCEPTED_LOSS" not in json.dumps(result["messages"])
    elif scenario == "retry-dialog":
        closed = next(record for record in records if record["event"] == "dialog_closed")
        assert closed["answer"] is False
        assert closed["goal"]["status"] == "active", "Dialog cancellation must not pause the goal"
        assert result["goal"]["status"] == "complete"
        assert result["calls"] == 3
    elif scenario in ("edit-cancel", "replace-cancel"):
        assert result["calls"] == 3
        assert result["goal"]["status"] == "complete"
        assert result["goal"]["objective"] == "Exercise interruption and resume"
        assert result["goal"]["goalId"] == result["savedGoalId"]
        assert not any(record["event"] == "settled" and record["goal"]["status"] == "paused" for record in records)
        terminal = (root / "terminal.ansi").read_text(errors="replace")
        assert ("Edit goal" if scenario == "edit-cancel" else "Replace current goal?") in terminal
    elif scenario.startswith("input-"):
        assert result["calls"] == (4 if scenario == "input-steer" else 5)
        assert result["goal"]["status"] == "complete"
        assert "USER_INPUT_PRESERVED" in json.dumps(result["messages"])
        assert "OTHER_EXTENSION_PRESERVED" in json.dumps(result["messages"])
        assert any(record["event"] == "input" and record.get("source") == "interactive" and record.get("text") == "USER_INPUT_PRESERVED" and record.get("streamingBehavior") == ("steer" if scenario == "input-steer" else "followUp") for record in records)
        assert any(record["event"] == "context" and "USER_INPUT_PRESERVED" in json.dumps(record["messages"]) for record in records)
        assert any(record["event"] == "context" and "OTHER_EXTENSION_PRESERVED" in json.dumps(record["messages"]) for record in records)
    elif scenario.startswith("compact"):
        settled = [record for record in records if record["event"] == "settled"]
        assert result["goal"]["status"] == "complete"
        # Accounting now accrues usage; lifecycle controls must preserve the baseline.
        assert result["goal"]["tokensUsed"] >= 37
        assert result["goal"]["elapsedSeconds"] >= 11
        assert result["goal"]["goalId"] == result["savedGoalId"]
        if scenario == "compact-success":
            assert result["calls"] == 4
            assert any(record["event"] == "compact_succeeded" for record in records)
        else:
            assert settled[0]["goal"]["status"] == ("paused" if scenario == "compact-cancel" else "blocked")
            assert settled[1]["goal"]["status"] == settled[0]["goal"]["status"]
            assert result["calls"] == 6
            failed = next(record for record in records if record["event"] == "compact_failed")
            assert failed["aborted"] is (scenario == "compact-cancel")
            if scenario == "compact-manual":
                assert any(record["event"] == "compact_succeeded" and record["reason"] == "manual" for record in records)
    else:
        first = next(record for record in records if record["event"] == "settled")
        assert first["goal"]["status"] == ("blocked" if scenario == "retry-c12" else "paused")
        assert first["calls"] == (10 if scenario == "loop-pause" else 1)
        assert result["calls"] == (12 if scenario == "loop-pause" else 3)
        if scenario == "loop-pause":
            assert first["goal"]["pauseReason"] == "repeated_tool_calls"
            assert "pauseReason" not in result["goal"]
            terminal = (root / "terminal.ansi").read_text(errors="replace")
            assert "Goal loop warning" in terminal
            assert "Goal paused after repeated tool calls" in terminal
        assert result["goal"]["status"] == "complete"
        assert result["goal"]["goalId"] == result["savedGoalId"]
        assert result["goal"]["tokensUsed"] >= 37
        assert result["goal"]["elapsedSeconds"] >= 11
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(20):
            waited, child_status = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = child_status
                break
            time.sleep(0.05)
        if status is None:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
    os.close(fd)
