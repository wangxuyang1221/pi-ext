"""Production goal footer and details acceptance through a real Pi PTY."""
import codecs
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
import sys
import termios
import time
import pyte

here = Path(__file__).resolve().parent
root = here.parent.parent.parent
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("node", ["node", str(here / "footer-tui.mjs"), *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 120, 0, 0))
screen = pyte.Screen(120, 45)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
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

def wait(predicate, label, seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()
        if predicate():
            return
        if status is not None:
            break
    raise AssertionError(f"Failed: {label}\n{view()}")

def settle(seconds=0.4):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()

def command(text):
    os.write(fd, text.encode() + b"\r")

try:
    wait(lambda: "Active · 12m · 12.3k / 80k tokens" in view(), "active summary")
    settle()
    assert "[Extension issues]" not in view(), view()
    screens["active"] = view()
    command("/goal")
    wait(lambda: "opening snapshot" in view() and "Tokens used:" in view(), "details")
    settle()
    exact = re.search(r"Elapsed: (\d+m \d+s)", view()).group(1)
    settle(1.2)
    assert re.search(r"Elapsed: (\d+m \d+s)", view()).group(1) == exact
    screens["details"] = view()
    os.write(fd, b"\x1b")
    wait(lambda: "opening snapshot" not in view(), "close details")
    command("/fixture-complete")
    wait(lambda: "Complete ·" in view(), "production completion tool")
    screens["complete"] = view()
    command("/goal resume")
    wait(lambda: "Active ·" in view(), "resume")
    command("/goal pause")
    wait(lambda: "Paused ·" in view(), "pause")
    command("/goal")
    wait(lambda: "[r] Resume" in view(), "resume action")
    os.write(fd, b"r")
    wait(lambda: "opening snapshot" not in view() and "Active ·" in view(), "panel resumes goal")
    command("/fixture-boundary")
    settle(0.5)
    minute = re.findall(r"Active · (\d+)m", view())[-1]
    wait(lambda: f"Active · {int(minute) + 1}m" in view(), "minute transition", 5)
    settle()
    before = len(output)
    settle(1.2)
    idle_bytes = len(output) - before
    assert idle_bytes == 0, f"Idle output: {idle_bytes} bytes"
    command("/goal pause")
    wait(lambda: "Paused ·" in view(), "freeze before resizing")
    for width in [80, 40, 120]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, width, 0, 0))
        screen.resize(45, width)
        settle(0.6)
        assert "Paused ·" in view(), view()
        screens[f"width-{width}"] = view()
    command("/goal clear")
    wait(lambda: "Goal cleared." in view(), "clear")
    settle()
    assert "Paused ·" not in view()
    command("/goal")
    wait(lambda: "No goal set" in view() and "opening snapshot" in view(), "empty details")
    os.write(fd, b"\x1b")
    wait(lambda: "opening snapshot" not in view(), "close empty details")
    command("/quit")
    wait(lambda: status is not None, "shutdown")
    assert os.waitstatus_to_exitcode(status) == 0
    mode = "-".join(arg.lstrip("-") for arg in sys.argv[1:]) or "regular"
    (root / ".tmp" / f"goal-footer-acceptance-{mode}.json").write_text(json.dumps({"passed": True, "pid": pid, "mode": mode, "idleTerminalBytes": idle_bytes, "screens": screens}, indent=2, ensure_ascii=False))
    print(json.dumps({"passed": True, "pid": pid, "mode": mode, "idleTerminalBytes": idle_bytes}))
finally:
    if status is None:
        os.kill(pid, signal.SIGTERM)
        end = time.monotonic() + 5
        while status is None and time.monotonic() < end:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
