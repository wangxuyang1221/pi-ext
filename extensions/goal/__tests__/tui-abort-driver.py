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
    os.execvp("node", ["node", "extensions/goal/__tests__/tui-abort-probe.mjs", package_root])

sent_probe = False
sent_exit = False
sent_followup = False
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
                os.write(fd, b"/probe\r")
                sent_probe = True
            if '"event":"waiting_for_typed_followup"' in events and not sent_followup:
                os.write(fd, b"TYPED_FOLLOWUP_MUST_SURVIVE\x1b\r")
                sent_followup = True
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
    if os.environ.get("GOAL_PROBE_ASSERT_PROTECTION") == "1":
        assert result["externalSeen"], "Unrelated extension message was lost by stale-goal cancellation"
        assert result["calls"] == 2, "Expected only initial and unrelated-extension requests"
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    os.close(fd)
