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
if (root / "events.jsonl").exists():
    raise FileExistsError("Use a fresh evidence directory for each probe run")
package_root = str(Path(sys.argv[2]).resolve())
pid, fd = pty.fork()
if pid == 0:
    os.environ["GOAL_PROBE_ROOT"] = str(root)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("node", ["node", "extensions/goal/__tests__/execution-tui.mjs", package_root])

sent_probe = False
sent_exit = False
sent_followup = False
sent_dialog_escape = False
scenario = os.environ.get("GOAL_TUI_SCENARIO", "retry-escape")
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
                os.write(fd, b"/goal Exercise actual interruption\r")
                sent_probe = True
            if '"event":"auto_retry_start"' in events and not sent_followup:
                time.sleep(0.15)
                os.write(fd, b"/probe-dialog\r" if scenario == "retry-dialog" else b"\x1b")
                sent_followup = True
            if '"event":"waiting_for_typed_followup"' in events and not sent_followup:
                os.write(fd, b"TYPED_FOLLOWUP_MUST_SURVIVE\x1b\r")
                sent_followup = True
            if '"event":"dialog_open"' in events and not sent_dialog_escape:
                time.sleep(0.2)
                os.write(fd, b"\x1b")
                sent_dialog_escape = True
            if '"event":"settled"' in events and not sent_exit:
                # Clear restored user text before entering the diagnostic exit command.
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
    else:
        assert result["goal"]["status"] == "paused", "Real retry interruption must pause the goal"
        assert result["calls"] == 1, "Escape must cancel the pending native retry"
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    os.close(fd)
