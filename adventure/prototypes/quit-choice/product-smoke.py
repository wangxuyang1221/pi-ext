"""Exercise the production /quit adapter with real Pi and isolated tmux."""

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
default_scenarios = [
    "empty",
    "leave",
    "end-running",
    "query-retry",
    "partial-close-retry",
    "cancel",
    "main-busy",
    "reload",
    "resume",
    "sighup-resume",
    "sigterm-resume",
    "sigkill-resume",
    "ctrld-resume",
]
scenarios = sys.argv[1:] or default_scenarios
results = []

for scenario in scenarios:
    unselected = scenario in [
        "sighup-resume",
        "sigterm-resume",
        "sigkill-resume",
        "ctrld-resume",
    ]
    report = repo / f".tmp/subagent-cleanup/product-{scenario}.jsonl"
    ansi = repo / f".tmp/subagent-cleanup/product-{scenario}.ansi"
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.environ["QUIT_PROBE_REPORT"] = str(report)
        backend = "product-unselected-resume" if unselected else "product-resume" if scenario == "resume" else "product"
        os.execvp("node", ["node", "adventure/prototypes/quit-choice/run.mjs", "combined", "regular", backend])
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
        raise AssertionError(f"{scenario}: " + output.decode(errors="replace")[-7000:])

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

    def choose_end():
        os.write(fd, b"\r")

    def choose_leave():
        os.write(fd, b"\x1b[B")
        time.sleep(0.1)
        os.write(fd, b"\r")

    def wait_for_choice(offset):
        wait(lambda: b"End session" in output[offset:] and b"Leave temporarily" in output[offset:])

    try:
        wait(lambda: re.search(rb"Prototype root: ([^\r\n]+)", output))
        root = Path(re.search(rb"Prototype root: ([^\r\n]+)", output)[1].decode())
        wait(lambda: len(events("ready")) == 1)
        if scenario == "resume" or unselected:
            command("Persist root session")
            wait(lambda: len(events("settled")) == 1)
        if scenario != "empty":
            command("/probe-spawn hold:work" if scenario == "end-running" else "/probe-spawn fast work")
            wait(lambda: len(events("probe-spawn")) == 1 or events("probe-spawn-error"))
            assert not events("probe-spawn-error"), events("probe-spawn-error")
            if scenario == "end-running":
                wait(lambda: (root / "home/started-work").exists())
            if scenario == "partial-close-retry":
                command("/probe-spawn second work")
                wait(lambda: len(events("probe-spawn")) == 2 or events("probe-spawn-error"))
                assert not events("probe-spawn-error"), events("probe-spawn-error")
                (root / "fail-close").write_text(events("probe-spawn")[1]["tmux"]["windowId"])
        if scenario == "reload":
            command("/reload")
            wait(lambda: len(events("ready")) == 2)
        if scenario == "main-busy":
            command("QUEUE_HOLD")
            wait(lambda: bool(events("request")))
            assert not events("settled")
        if scenario == "query-retry":
            (root / "fail-query").write_text("fail")
        if unselected:
            original = events("start")[0]
            child_pid = events("probe-spawn")[0]["tmux"]["panePid"]
            if scenario == "ctrld-resume":
                os.write(fd, b"\x04")
            else:
                selected_signal = {
                    "sighup-resume": signal.SIGHUP,
                    "sigterm-resume": signal.SIGTERM,
                    "sigkill-resume": signal.SIGKILL,
                }[scenario]
                os.kill(original["pid"], selected_signal)
            wait(lambda: len(events("start")) == 2 and len(events("ready")) == 2)
            assert not alive(original["pid"])
            assert alive(child_pid)
            assert events("start")[1]["session"] == original["session"]

        offset = len(output)
        quit_started = time.monotonic()
        command("/quit")
        if scenario == "empty":
            wait(lambda: status is not None)
            assert b"Leave temporarily" not in output[offset:]
        elif scenario == "query-retry":
            wait(lambda: b"Could not verify subagent status" in output[offset:] or b"Could not check subagents" in output[offset:])
            assert status is None
            assert all(alive(row["tmux"]["panePid"]) for row in events("probe-spawn"))
            (root / "fail-query").unlink()
            offset = len(output)
            command("/quit")
            wait_for_choice(offset)
            choose_end()
            wait(lambda: status is not None)
        else:
            wait_for_choice(offset)
            if scenario in ["leave", "resume"]:
                choose_leave()
            elif scenario == "cancel":
                os.write(fd, b"\x1b")
                time.sleep(0.3)
                settled_before = len(events("settled"))
                command("Probe $alpha after cancel")
                wait(lambda: len(events("settled")) == settled_before + 1)
                assert "ALPHA_BODY" in json.dumps(events("request"))
                offset = len(output)
                command("/quit")
                wait_for_choice(offset)
                choose_end()
            else:
                choose_end()

            if scenario == "resume":
                wait(lambda: len(events("start")) == 2 and len(events("ready")) == 2)
                starts = events("start")
                assert starts[0]["session"] == starts[1]["session"]
                assert starts[0]["pid"] != starts[1]["pid"]
                assert all(alive(row["tmux"]["panePid"]) for row in events("probe-spawn"))
                offset = len(output)
                command("/quit")
                wait_for_choice(offset)
                choose_end()
            if scenario == "partial-close-retry":
                wait(lambda: b"Could not end the session" in output[offset:])
                assert status is None
                children = events("probe-spawn")
                wait(lambda: not alive(children[0]["tmux"]["panePid"]))
                assert alive(children[1]["tmux"]["panePid"])
                (root / "fail-close").unlink()
                offset = len(output)
                command("/quit")
                wait_for_choice(offset)
                choose_end()
            wait(lambda: status is not None)

        assert os.waitstatus_to_exitcode(status) == 0, output.decode(errors="replace")[-7000:]
        rows = [json.loads(line) for line in report.read_text().splitlines()]
        values = lambda kind: [row["data"] for row in rows if row["type"] == kind]
        summary = json.loads(Path(str(report) + ".summary.json").read_text())
        cleanup = json.loads(Path(str(report) + ".cleanup.json").read_text())
        assert summary["keeperAlive"], summary
        assert not cleanup["livePids"] and cleanup["socketUnavailable"]
        assert not root.exists()
        expected_shutdowns = ["reload", "quit"] if scenario == "reload" else ["quit", "quit"] if scenario == "resume" or unselected and scenario != "sigkill-resume" else ["quit"]
        assert values("shutdown") == expected_shutdowns, values("shutdown")
        if scenario == "leave":
            assert all(row["alive"] for row in summary["agents"]), summary
        elif scenario != "empty":
            assert not any(row["alive"] for row in summary["agents"]), summary
        if scenario == "main-busy":
            assert values("settled"), "The controlled main request was not aborted"
            assert time.monotonic() - quit_started < 3, "The controlled request reached its natural four-second completion"
        if unselected:
            assert len(values("start")) == 2
            if scenario == "sigkill-resume":
                assert values("probe-process-exit")[0]["signal"] == "SIGKILL"
        assert not alive(pid)
        assert all(not alive(row["pid"]) for row in values("start"))
        for child_pid in cleanup["pids"]:
            assert not alive(child_pid), child_pid
        result = {
            "scenario": scenario,
            "passed": True,
            "mainPids": [row["pid"] for row in values("start")],
            "unselectedResume": unselected,
            "observedShutdownEvents": values("shutdown"),
            "beforeLauncherCleanup": summary,
            "cleanup": cleanup,
            "launcherPid": pid,
            "quitElapsedMs": round((time.monotonic() - quit_started) * 1000),
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

result_file = repo / "adventure/evidence/subagent-quit-product-results.json"
previous = json.loads(result_file.read_text()) if result_file.exists() else []
merged = [row for row in previous if row["scenario"] not in scenarios] + results
result_file.write_text(json.dumps(merged, indent=2) + "\n")
