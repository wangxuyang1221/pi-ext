"""Run the production /quit adapter across native, Codex, and skill editors."""

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
import sys


repo = Path(__file__).resolve().parents[3]
matrix = [
    ("native", "regular"),
    ("native", "fullscreen"),
    ("codex", "regular"),
    ("combined", "regular"),
    ("combined", "fullscreen"),
    ("reverse", "regular"),
]
results = []
requested = set(sys.argv[1:])

for host, mode in matrix:
    for choice in ["Leave temporarily", "End session"]:
        slug = f"{host}-{mode}-{choice.replace(' ', '-')}"
        if requested and slug not in requested:
            continue
        report = repo / f".tmp/subagent-cleanup/product-entry-{slug}.jsonl"
        ansi = repo / f".tmp/subagent-cleanup/product-entry-{slug}.ansi"
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(repo)
            os.environ["QUIT_PROBE_REPORT"] = str(report)
            os.execvp("node", [
                "node",
                "adventure/prototypes/quit-choice/run.mjs",
                host,
                mode,
                "product",
            ])
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        output = bytearray()
        status = None
        root = None

        def events(kind):
            path = root / "events.jsonl"
            if not path.exists():
                return []
            return [
                row["data"]
                for line in path.read_text().splitlines()
                if (row := json.loads(line))["type"] == kind
            ]

        def wait(predicate, timeout=40):
            global status
            deadline = time.monotonic() + timeout
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
            raise AssertionError(f"{slug}: " + output.decode(errors="replace")[-7000:])

        def command(text):
            os.write(fd, ("\x1b[200~" + text + "\x1b[201~").encode())
            time.sleep(0.15)
            os.write(fd, b"\r")

        def alive(target):
            try:
                os.kill(target, 0)
                return True
            except ProcessLookupError:
                return False

        try:
            wait(lambda: re.search(rb"Prototype root: ([^\r\n]+)", output))
            root = Path(re.search(rb"Prototype root: ([^\r\n]+)", output)[1].decode())
            wait(lambda: len(events("ready")) == 1)
            command("/probe-spawn fast work")
            wait(lambda: len(events("probe-spawn")) == 1 or events("probe-spawn-error"))
            assert not events("probe-spawn-error"), events("probe-spawn-error")
            agent_pid = events("probe-spawn")[0]["tmux"]["panePid"]

            offset = len(output)
            command("/quit")
            wait(lambda: b"End session" in output[offset:] and b"Leave temporarily" in output[offset:])
            os.write(fd, b"\x1b")
            time.sleep(0.3)
            settled_before = len(events("settled"))
            command("Probe $alpha after cancel")
            wait(lambda: len(events("settled")) == settled_before + 1)
            assert alive(agent_pid)
            if host in ["combined", "reverse"]:
                assert "ALPHA_BODY" in json.dumps(events("request"))

            offset = len(output)
            command("/quit")
            wait(lambda: b"End session" in output[offset:] and b"Leave temporarily" in output[offset:])
            if choice == "Leave temporarily":
                os.write(fd, b"\x1b[B")
                time.sleep(0.1)
            os.write(fd, b"\r")
            wait(lambda: status is not None)

            assert os.waitstatus_to_exitcode(status) == 0, output.decode(errors="replace")[-7000:]
            rows = [json.loads(line) for line in report.read_text().splitlines()]
            values = lambda kind: [row["data"] for row in rows if row["type"] == kind]
            summary = json.loads(Path(str(report) + ".summary.json").read_text())
            cleanup = json.loads(Path(str(report) + ".cleanup.json").read_text())
            assert values("shutdown") == ["quit"]
            assert summary["keeperAlive"], summary
            assert summary["agents"][0]["alive"] == (choice == "Leave temporarily"), summary
            assert not cleanup["livePids"] and cleanup["socketUnavailable"]
            assert not root.exists()
            assert not alive(pid)
            assert all(not alive(row["pid"]) for row in values("start"))
            result = {
                "host": host,
                "mode": mode,
                "choice": choice,
                "cancelKeepsSession": True,
                "normalPromptAfterCancel": True,
                "skillExpandedAfterCancel": host in ["combined", "reverse"],
                "shutdownReason": "quit",
                "agentAliveBeforeLauncherCleanup": summary["agents"][0]["alive"],
                "keeperAliveBeforeLauncherCleanup": summary["keeperAlive"],
                "cleanup": cleanup,
                "launcherPid": pid,
                "rootRemoved": True,
            }
            results.append(result)
            print(json.dumps(result), flush=True)
        finally:
            if status is None:
                os.killpg(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
                if root and (root / "tmux").exists():
                    import subprocess
                    subprocess.run([str(root / "tmux"), "kill-server"], capture_output=True)
            os.close(fd)
            ansi.write_bytes(output)

(repo / "adventure/evidence/subagent-quit-product-entry-results.json").write_text(
    json.dumps(results, indent=2) + "\n"
)
