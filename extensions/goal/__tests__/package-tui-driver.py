"""Install an unpacked release through Pi CLI, then verify SDK and real PTY loading."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import time

root = Path(sys.argv[1]).resolve()
package = Path(sys.argv[2]).resolve()
distribution = Path(sys.argv[3]).resolve()
repo = Path(__file__).resolve().parents[3]
assert root.is_relative_to(repo)
root.mkdir(parents=True, exist_ok=True)
assert not (root / "results.json").exists(), "Use a fresh evidence directory"
pids = []


def environment(case):
    for name in ("home", "tmp", "agent", "sessions"):
        (case / name).mkdir(parents=True, exist_ok=True)
    (case / "agent/settings.json").write_text(json.dumps({"compaction": {"enabled": False}, "retry": {"enabled": False}, "enableInstallTelemetry": False}))
    env = {key: os.environ[key] for key in ("PATH", "LANG") if key in os.environ}
    env.update({"HOME": str(case / "home"), "TMPDIR": str(case / "tmp"), "PI_CODING_AGENT_DIR": str(case / "agent"),
                "PI_CODING_AGENT_SESSION_DIR": str(case / "sessions"), "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "TERM": "xterm-256color", "SHELL": "/bin/sh"})
    with (case / "install.log").open("wb") as log:
        process = subprocess.Popen(["node", str(package / "dist/cli.js"), "install", str(distribution), "--no-approve"], cwd=case, env=env, stdout=log, stderr=subprocess.STDOUT)
        pids.append(process.pid)
        try:
            assert process.wait(timeout=30) == 0, "Pi local installation failed"
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    settings = json.loads((case / "agent/settings.json").read_text())
    installed = [(case / "agent" / entry).resolve() for entry in settings["packages"]]
    assert distribution in installed, "CLI must persist the installed package path relative to settings"
    return env


case = root / "runtime"
env = environment(case)
env["GOAL_INTEGRATION_EVIDENCE"] = str(case)
with (case / "runtime.log").open("wb") as log:
    process = subprocess.Popen(["node", "extensions/goal/__tests__/integration-runtime.mjs", str(package), str(distribution)], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    pids.append(process.pid)
    try:
        assert process.wait(timeout=90) == 0, "Installed package lifecycle failed"
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)

case = root / "tui"
env = environment(case)
env["GOAL_PACKAGE_EVIDENCE"] = str(case)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.execvpe("node", ["node", "extensions/goal/__tests__/package-tui.mjs", str(package), str(distribution)], env)
pids.append(pid)
(root / "pids.json").write_text(json.dumps(pids))
status = None
stage = 0
ready_at = None
try:
    with (case / "terminal.ansi").open("wb") as transcript:
        deadline = time.monotonic() + 35
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
            terminal = (case / "terminal.ansi").read_text(errors="replace")
            events_file = case / "events.jsonl"
            if ready_at is None and events_file.exists() and '"event":"ready"' in events_file.read_text():
                ready_at = time.monotonic()
            if stage == 0 and ready_at is not None and time.monotonic() - ready_at >= 2:
                os.write(fd, b"/goal Package installed goal\r")
                stage = 1
            if stage == 1 and "Goal saved" in terminal:
                os.write(fd, b"/goal pause\r")
                stage = 2
            if stage == 2 and "Goal paused" in terminal:
                os.write(fd, b"/package-verify\r")
                stage = 3
            waited, child_status = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = child_status
                break
        assert status is not None, "Installed TUI timed out"
        assert os.waitstatus_to_exitcode(status) == 0, "Installed TUI failed"
    events = [json.loads(line) for line in (case / "events.jsonl").read_text().splitlines()]
    result = next(row for row in events if row["event"] == "result")
    assert result["passed"] and result["networkAttempts"] == 0
    assert "Goal: paused" in terminal
    assert "Extension error" not in terminal
    (root / "results.json").write_text(json.dumps({"passed": True, "pids": pids, "tui": result, "runtime": str(root / "runtime/results.json")}, indent=2))
    print(json.dumps({"passed": True, "version": result["version"], "pids": pids}))
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(30):
            waited, child_status = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = child_status
                break
            time.sleep(0.1)
        if status is None:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
    os.close(fd)
    (root / "pids.json").write_text(json.dumps(pids))
