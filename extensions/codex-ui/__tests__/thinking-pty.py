"""Drive the actual Pi InteractiveMode in a PTY, with a scripted offline provider."""
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
repo = here.parent.parent.parent
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLORTERM"] = "truecolor"
    os.execvp("node", ["node", str(here / "fixtures" / "thinking-cli.mjs"), *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 110, 0, 0))
screen = pyte.Screen(110, 60)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
status = None
output = bytearray()


def view():
    return "\n".join(line.rstrip() for line in screen.display)


def pump():
    global status
    if select.select([fd], [], [], 0.03)[0]:
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
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()
        if predicate():
            return
        if status is not None:
            break
    raise AssertionError(f"Failed: {label}\n{view()}")


def settle(seconds=0.25):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()


def command(text):
    os.write(fd, text.encode() + b"\r")


def assert_native_italic(text):
    for y, line in enumerate(screen.display):
        if text in line:
            cell = screen.buffer[y][line.index(text)]
            assert cell.italics, "The production renderer must retain native italics"
            assert cell.fg == "85858a", cell.fg
            return
    raise AssertionError(f"Missing body: {text}\n{view()}")


try:
    wait(lambda: "The complete thinking text" in view(), "initial fixture")
    settle()
    assert "Extension issues" not in view()
    assert view().count("│ Thinking") == 1, view()
    assert "Read display.ts" in view(), view()
    assert "- The complete thinking text" in view(), "The production reply transformer must remain installed"
    assert_native_italic("The request is")
    os.write(fd, b"\x14")
    wait(lambda: "Thinking..." in view() and "Checking the rendering boundary" not in view(), "native collapse")
    settle()
    assert "The complete thinking text" in view()
    os.write(fd, b"\x14")
    wait(lambda: "Checking the rendering boundary" in view(), "native expand")
    command("/play")
    wait(lambda: "A plain-text response" in view().split("Replay the thinking fixture.")[-1], "incremental body")
    os.write(fd, b"\x14")
    wait(lambda: "Replay complete." in view(), "real stream finishes")
    settle()
    tail = view().split("Replay the thinking fixture.")[-1]
    assert "Thinking..." in tail, tail
    assert "A plain-text response" not in tail, "Completion must not expand hidden thinking"
    os.write(fd, b"\x14")
    wait(lambda: "A plain-text response" in view().split("Replay the thinking fixture.")[-1], "completed stream expands")
    for width in [48, 110]:
        screen.resize(60, width)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, width, 0, 0))
        settle(0.6)
        assert "Replay complete." in view(), view()
    command("/quit")
    wait(lambda: status is not None, "clean exit")
    assert os.waitstatus_to_exitcode(status) == 0
    mode = "fullscreen" if "--fullscreen" in sys.argv else "regular"
    print(json.dumps({"passed": True, "mode": mode, "pid": pid, "production": True}))
finally:
    if status is None:
        (repo / ".tmp" / "thinking-production-failed.ansi").write_bytes(output)
        os.kill(pid, signal.SIGTERM)
        end = time.monotonic() + 5
        while status is None and time.monotonic() < end:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
