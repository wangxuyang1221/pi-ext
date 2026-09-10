"""Drive the real InteractiveMode with offline native Codex response fixtures."""
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
    raise FileExistsError("Use a fresh evidence directory")
package_root = str(Path(sys.argv[2]).resolve())
scenario = os.environ.get("GOAL_BUDGET_SCENARIO", "soft")
pid, fd = pty.fork()
if pid == 0:
    os.environ["GOAL_PROBE_ROOT"] = str(root)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("node", ["node", "extensions/goal/__tests__/budget-tui.mjs", package_root])
(root / "pid.txt").write_text(str(pid))
status = None
stage = 0
interrupted = False
next_action = 0
try:
    with (root / "terminal.ansi").open("wb") as transcript:
        deadline = time.monotonic() + 25
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
            if stage == 0 and '"event":"ready"' in events:
                time.sleep(0.3)
                os.write(fd, b"Explicitly create the goal\r" if scenario == "baseline" else b"/goal Budget TUI fixture\r")
                stage = 1
            if scenario == "interrupt" and not interrupted and '"event":"waiting_wrap"' in events:
                os.write(fd, b"\x1b")
                interrupted = True
            if stage == 1 and '"event":"settled"' in events:
                time.sleep(0.15)
                os.write(fd, b"/goal\r")
                stage = 2
            terminal = (root / "terminal.ansi").read_text(errors="replace")
            if stage == 2 and "Tokens used:" in terminal:
                os.write(fd, b"/goal edit\r")
                stage = 3
            if stage == 3 and "Edit goal" in terminal:
                os.write(fd, b"\x1b")
                next_action = time.monotonic() + 0.6
                stage = 3.5
            if stage == 3.5 and time.monotonic() >= next_action:
                if scenario in ("soft", "baseline"):
                    os.write(fd, b"/goal resume\r")
                next_action = time.monotonic() + 0.4
                stage = 3.75
            if stage == 3.75 and time.monotonic() >= next_action:
                os.write(fd, b"/reload\r")
                stage = 4
            # session_start precedes InteractiveMode restoring input after reload.
            if stage == 4 and '"readyCount":2' in events and "Reloaded keybindings" in terminal:
                time.sleep(0.3)
                os.write(fd, b"/goal\r")
                time.sleep(0.2)
                os.write(fd, b"/budget-exit\r")
                stage = 5
            waited, child_status = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = child_status
                break
        if status is None:
            raise TimeoutError("Budget TUI did not exit within 25 seconds")
    assert os.waitstatus_to_exitcode(status) == 0, f"TUI child failed: {status}"
    records = [json.loads(line) for line in (root / "events.jsonl").read_text().splitlines()]
    result = next(row for row in records if row["event"] == "result")
    assert result["networkAttempts"] == 0
    assert result["calls"] == (3 if scenario == "baseline" else 2)
    assert result["readyCount"] == 2
    assert result["goal"]["tokensUsed"] == (100 if scenario in ("quota", "interrupt") else 110)
    assert result["goal"]["tokenBudget"] == 100
    assert result["goal"]["objective"] == ("Explicit baseline goal" if scenario == "baseline" else "Budget TUI fixture")
    assert result["goal"]["status"] == ("usage_limited" if scenario == "quota" else "paused" if scenario == "interrupt" else "budget_limited")
    budget_contexts = [message for row in records if row["event"] == "context" for message in row["messages"] if message.get("customType") == "pi-ext-goal-budget"]
    assert len(budget_contexts) == 1, "Exactly one wrap-up prompt must reach model context"
    terminal = (root / "terminal.ansi").read_text(errors="replace")
    assert "Tokens used:" in terminal and "Edit goal" in terminal
    if scenario in ("quota", "interrupt"):
        assert result["goal"]["usageIncomplete"] is True
        assert "usage is incomplete" in terminal
    summary = {"pid": pid, "exited": True, "version": result["version"], "scenario": scenario, "calls": result["calls"], "goal": result["goal"], "networkAttempts": 0, "passed": True}
    (root / "result.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
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
