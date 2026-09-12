"""Exercise the real Pi CLI, production Codex UI, and goal fixture through a PTY."""
import codecs
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import sys
import termios
import time

import pyte

here = Path(__file__).resolve().parent
root = here.parent.parent
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("node", ["node", str(here / "demo.mjs"), *sys.argv[1:]])

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
screen = pyte.Screen(120, 40)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
status = None
output = bytearray()
screens = {}


def view():
    return "\n".join(line.rstrip() for line in screen.display)


def pump():
    global status
    ready, _, _ = select.select([fd], [], [], 0.04)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        output.extend(data)
        stream.feed(decoder.decode(data))
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value


def wait(predicate, label, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pump()
        if predicate():
            return
        if status is not None:
            raise AssertionError(f"Exited before {label}: {status}\n{view()}")
    raise TimeoutError(f"{label}\n{view()}")


def settle(seconds=0.4):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()


def command(text):
    os.write(fd, text.encode() + b"\r")


try:
    wait(lambda: "Active · 12m · 12.3k / 80k tokens" in view(), "active footer")
    settle()
    screens["active"] = view()
    assert "Offline prototype" in view(), "The real transcript fixture must be visible"
    assert "[Extension issues]" not in view(), view()
    assert "This project is not trusted" not in view(), view()
    command("/goal pause")
    wait(lambda: "Paused · 12m" in view(), "paused footer")
    screens["paused"] = view()
    command("/goal")
    wait(lambda: "No per-second timer" in view(), "details")
    settle()
    assert "12,345 / 80,000" in view(), view()
    assert "Snapshot" in view() or "snapshot" in view()
    assert "No per-second timer" in view()
    screens["details"] = view()
    os.write(fd, b"\x1b")
    wait(lambda: "Goal details" not in view(), "close details")
    command("/goal boundary")
    wait(lambda: "Active · 12m" in view(), "boundary fixture")
    wait(lambda: "Active · 13m" in view(), "minute transition", 5)
    settle()
    screens["boundary"] = view()
    before = len(output)
    settle(1.4)
    idle_bytes = len(output) - before
    assert idle_bytes == 0, f"Unexpected idle terminal output: {idle_bytes} bytes"
    command("/goal complete")
    wait(lambda: "Complete · 13m" in view(), "completion")
    screens["complete"] = view()
    command("/goal fresh")
    wait(lambda: "Active · <1m" in view(), "fresh fixture")
    command("/goal hour")
    wait(lambda: "Active · 59m" in view(), "hour fixture")
    wait(lambda: "Active · 1h 00m" in view(), "hour transition", 5)
    command("/goal pause")
    wait(lambda: "Paused · 1h 00m" in view(), "paused hour")
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 40, 0, 0))
    screen.resize(40, 40)
    wait(lambda: "Paused · 1h 00m" in view(), "narrow footer")
    settle()
    screens["narrow"] = view()
    command("hello")
    wait(lambda: "Offline fixture" in view(), "input interception")
    command("/quit")
    wait(lambda: status is not None, "graceful shutdown")
    assert os.waitstatus_to_exitcode(status) == 0
    (here / ".tmp" / "last-smoke.json").write_text(json.dumps({
        "passed": True, "pid": pid, "exited": True,
        "idleWindowSeconds": 1.4, "idleTerminalBytes": idle_bytes, "screens": screens,
    }, indent=2, ensure_ascii=False))
    print(json.dumps({"passed": True, "pid": pid, "exited": True, "idleTerminalBytes": idle_bytes}))
finally:
    if status is None:
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 5
        while status is None and time.monotonic() < deadline:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
    if status is None or os.waitstatus_to_exitcode(status) != 0:
        print(view())
