"""Check the prototype in real Pi InteractiveMode through a pseudo-terminal."""
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
repo = here.parents[3]
mode = "fullscreen" if "--fullscreen" in sys.argv else "regular"
before = set((repo / ".tmp").glob("goal-tool-ui-*"))
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("node", ["node", str(here / "demo.mjs"), *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 64, 120, 0, 0))
screen = pyte.Screen(120, 64)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
status = None
screens = {}
raw = bytearray()


def view():
    return "\n".join(line.rstrip() for line in screen.display)


def pump():
    global status
    ready, _, _ = select.select([fd], [], [], 0.04)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        raw.extend(chunk)
        stream.feed(decoder.decode(chunk))
    if status is None:
        done, code = os.waitpid(pid, os.WNOHANG)
        if done:
            status = code


def wait(predicate, label, timeout=35):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        pump()
        if predicate():
            return
        if status is not None:
            break
    raise AssertionError(f"Failed: {label}\n{view()}")


def settle(duration=0.35):
    end = time.monotonic() + duration
    while time.monotonic() < end:
        pump()


def command(text):
    os.write(fd, text.encode() + b"\r")


def scenario(name):
    command(f"/demo {name}")
    wait(lambda: f"Review ready: {name}." in view(), f"scenario {name}")
    settle()


def marker(label):
    for y in reversed(range(screen.lines)):
        line = screen.display[y]
        if label in line and "⏺" in line:
            return screen.buffer[y][line.index("⏺")].fg
    return None


try:
    wait(lambda: "Review ready: compare." in view(), "initial mixed tools")
    settle()
    assert "Extension issues" not in view(), view()
    for label in ["Bash(", "Created goal", "Read goal", "Updated goal", "ui-note.txt"]:
        assert label in view(), (label, view())
    assert "12.5k / 50k tokens" in view(), view()
    assert marker("Updated goal") == "4dff88", view()
    screens["summary"] = view()
    command("/variant minimal")
    wait(lambda: "Prototype: minimal" in view(), "minimal variant")
    settle()
    assert "12.5k / 50k tokens" not in view(), view()
    assert "Updated goal" in view(), view()
    screens["minimal"] = view()
    os.write(fd, b"\x0f")
    wait(lambda: "Tokens: 12,480 / 50,000" in view(), "native expansion")
    settle()
    assert "Thread: prototype-session" in view(), view()
    screens["expanded"] = view()
    os.write(fd, b"\x0f")
    settle()
    command("/variant summary")
    wait(lambda: "Prototype: summary" in view(), "summary restored")
    scenario("long")
    assert "LONG-GOAL-END" not in view(), view()
    for width in [40, 80, 120]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 64, width, 0, 0))
        screen.resize(64, width)
        settle(0.7)
        assert "Read goal" in view(), view()
        screens[f"width-{width}"] = view()
    os.write(fd, b"\x0f")
    wait(lambda: "LONG-GOAL-END" in view(), "complete long objective")
    settle()
    screens["long-expanded"] = view()
    os.write(fd, b"\x0f")
    settle()
    scenario("error")
    assert "No goal exists." in view(), view()
    assert marker("Update goal failed") == "ff6b6b", view()
    screens["error"] = view()
    os.write(fd, b"\x0f")
    wait(lambda: "Create a goal before updating" in view(), "expanded error")
    os.write(fd, b"\x0f")
    settle()
    scenario("empty")
    assert "No goal" in view(), view()
    assert marker("Read goal") == "4dff88", view()
    screens["empty"] = view()
    for state in ["paused", "blocked"]:
        scenario(state)
        assert f"Updated goal · {state.title()}" in view(), view()
        assert marker("Updated goal") == "4dff88", view()
        screens[state] = view()
    scenario("incomplete")
    assert "Observed usage only" in view(), view()
    screens["incomplete"] = view()
    scenario("unbounded")
    assert "12.5k tokens" in view(), view()
    screens["unbounded"] = view()
    command("/demo running")
    wait(lambda: "Reading goal" in view(), "held running tool")
    assert marker("Reading goal") == "ffe66d", view()
    screens["running"] = view()
    command("/finish")
    wait(lambda: "Review ready: running." in view(), "finish held tool")
    settle()
    assert marker("Read goal") == "4dff88", view()
    command("/fixture-theme light")
    wait(lambda: marker("Read goal") not in [None, "4dff88"], "theme redraw")
    settle()
    assert marker("Read goal") not in [None, "4dff88"], view()
    screens["light"] = view()
    command("/fixture-theme codex-pi")
    wait(lambda: marker("Read goal") == "4dff88", "theme restored")
    settle()
    command("/demo running")
    wait(lambda: "Reading goal" in view(), "running call before shutdown")
    command("/quit")
    wait(lambda: status is not None, "clean shutdown")
    assert os.waitstatus_to_exitcode(status) == 0, os.waitstatus_to_exitcode(status)
    assert set((repo / ".tmp").glob("goal-tool-ui-*")) == before, "Sandbox was not cleaned up"
    evidence = here.parents[1] / "evidence" / "prototype"
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / f"{mode}.json").write_text(json.dumps({"passed": True, "mode": mode, "pid": pid, "sandboxRemoved": True, "screens": screens}, ensure_ascii=False, indent=2))
    print(json.dumps({"passed": True, "mode": mode, "pid": pid, "screens": list(screens), "sandboxRemoved": True}))
finally:
    (repo / ".tmp" / f"goal-ui-{mode}-last.ansi").write_bytes(raw)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        end = time.monotonic() + 5
        while status is None and time.monotonic() < end:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
