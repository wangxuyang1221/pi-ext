"""Check the manual launcher's isolation and restart plumbing, not physical IME/font behavior."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import termios
import time

repo = Path(__file__).resolve().parents[2]
results = []
for host, mode in [("native", "regular"), ("codex", "regular"), ("native", "fullscreen"), ("codex", "fullscreen")]:
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.execvp("node", ["node", "extensions/skill-mentions/__tests__/manual-terminal.mjs", host, mode])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    output, status, root = bytearray(), None, None

    def wait(predicate):
        global status
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    output.extend(os.read(fd, 65536))
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            if status is None:
                done, value = os.waitpid(pid, os.WNOHANG)
                if done:
                    status = value
            if predicate():
                return
        raise AssertionError(output.decode(errors="replace")[-6000:])

    def events(kind):
        path = root / "events.jsonl"
        return [item["data"] for line in path.read_text().splitlines() if (item := json.loads(line))["type"] == kind] if path.exists() else []

    def command(text):
        os.write(fd, ("\x1b[200~" + text + "\x1b[201~").encode())
        time.sleep(0.15)
        os.write(fd, b"\r")

    try:
        wait(lambda: re.search(rb"Config: ([^\r\n]+)", output))
        root = Path(re.search(rb"Config: ([^\r\n]+)", output)[1].decode())
        wait(lambda: len(events("ready")) == 1)
        command("用 $alpha")
        wait(lambda: len(events("settled")) == 1)
        command("/skill-label-icon command")
        preference = root / "agent/skill-mentions.json"
        wait(lambda: preference.exists() and json.loads(preference.read_text())["icon"] == "command")
        command("/quit")
        wait(lambda: len(events("ready")) == 2)
        starts = events("start")
        assert starts[0]["pid"] != starts[1]["pid"] and all(start["tty"] for start in starts)
        assert "⌘alpha" in output.decode(errors="replace")
        assert json.loads(preference.read_text())["icon"] == "command"
        assert "ALPHA_MANUAL_BODY" in Path(starts[-1]["session"]).read_text()
        command("/quit")
        wait(lambda: status is not None)
        assert os.waitstatus_to_exitcode(status) == 0 and not root.exists()
        for start in starts:
            try:
                os.kill(start["pid"], 0)
            except ProcessLookupError:
                pass
            else:
                raise AssertionError(f"Live child: {start['pid']}")
        results.append({"host": host, "mode": mode, "launcherPid": pid, "cliPids": [start["pid"] for start in starts], "passed": True, "temporaryRootRemoved": True})
    finally:
        if status is None:
            os.killpg(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
        os.close(fd)

(repo / "adventure/evidence/skill-final-manual-smoke.json").write_text(json.dumps({"results": results, "physicalIme": "not tested", "physicalFont": "not observed"}, indent=2) + "\n")
print(json.dumps(results))
