"""Verify the real Pi TUI with offline search fixtures and native expansion."""
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
repo = here.parents[2]
before = set((repo / ".tmp").glob("web-search-*"))
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLORTERM"] = "truecolor"
    os.execvp("node", ["node", str(here.parent / "src/demo.mjs"), *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 90, 120, 0, 0))
screen = pyte.Screen(120, 90)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
status = None
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

def settle(seconds=0.5):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()

def command(value):
    os.write(fd, value.encode() + b"\r")

def search_colors():
    return [screen.buffer[y][line.index("⌕")].fg for y, line in enumerate(screen.display)
            if "⌕ " in line and any(word in line for word in ["Searched web", "Searching web", "Web search"]) ]

try:
    wait(lambda: "2/5 queries completed" in view(), "streaming progress")
    screens["running"] = view()
    assert search_colors()[-1] == "ffe66d", search_colors()
    wait(lambda: "Playback complete." in view(), "initial success")
    settle()
    assert "Extension issues" not in view(), view()
    assert "17 sources · 5 queries" in view(), view()
    assert search_colors()[-1] == "85858a", search_colors()
    screens["success"] = view()
    os.write(fd, b"\x0f")
    wait(lambda: "https://example.com/research/17" in view(), "native expansion")
    screens["expanded"] = view()
    os.write(fd, b"\x0f")
    settle()
    for outcome, expected, color in [("partial", "4/5 succeeded · 1 failed", "ffe66d"), ("timeout", "Request timed out", "ffe66d"), ("error", "Search service unavailable", "ff6b6b")]:
        command("/hold")
        wait(lambda: "0/5 queries completed" in view(), "held search")
        command(f"/finish {outcome}")
        wait(lambda: expected in view(), outcome)
        settle()
        assert search_colors()[-1] == color, (outcome, search_colors())
        screens[outcome] = view()
        if outcome == "timeout" and "--production" in sys.argv:
            command("/reload")
            wait(lambda: "Reloaded" in view(), "reload production renderer")
            settle()
            assert "Web search timed out" in view(), view()
            assert search_colors()[-1] == "ffe66d", search_colors()
            screens["reloaded-timeout"] = view()
    command("/play batch")
    wait(lambda: "1/2 succeeded · 1 failed" in view(), "adjacent batch")
    settle()
    lines = view().splitlines()
    positions = [i for i, line in enumerate(lines) if "⌕ Searched web" in line]
    a, b = positions[-2:]
    assert b - a == 3, (a, b, lines[a:b+1])
    assert not lines[a + 2].strip(), lines[a:b+1]
    screens["batch"] = view()
    for width in [40, 80, 120]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 90, width, 0, 0))
        screen.resize(90, width)
        settle()
        assert "1/2 succeeded · 1 failed" in view(), view()
        screens[f"width-{width}"] = view()
    command("/theme light")
    settle()
    screens["light"] = view()
    command("/theme codex-pi")
    settle()
    command("/hold")
    wait(lambda: "0/5 queries completed" in view(), "hold before stop")
    command("/play stop")
    settle(1)
    command("/play single")
    wait(lambda: "5 sources · 1 query" in view(), "replay after cancellation")
    settle()
    if "--restart" in sys.argv:
        command("/hold")
        wait(lambda: "0/5 queries completed" in view(), "hold before persisted timeout")
        command("/finish timeout")
        wait(lambda: "Web search timed out" in view() and search_colors()[-1] == "ffe66d", "persist timeout")
        settle(1)
        command("/quit")
        wait(lambda: "Restored search history." in view(), "restart with persisted session")
        assert "Web search timed out" in view(), view()
        assert search_colors()[-1] == "ffe66d", search_colors()
        screens["restarted-timeout"] = view()
    command("/quit")
    wait(lambda: status is not None, "clean exit")
    assert os.waitstatus_to_exitcode(status) == 0, status
finally:
    if status is None:
        command("/quit")
        settle(2)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        settle(3)
    if status is None:
        os.killpg(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(fd)
    suffix = ("production-" if "--production" in sys.argv else "") + ("fullscreen" if "--fullscreen" in sys.argv else "regular")
    output = repo / ".tmp" / f"web-search-{suffix}-smoke.json"
    output.write_text(json.dumps(screens, ensure_ascii=False, indent=2))
# Exclude the evidence JSON files from workspace cleanup checks.
after = {path for path in (repo / ".tmp").glob("web-search-*") if path.is_dir()}
assert after == {path for path in before if path.is_dir()}, after
print("Web search PTY smoke passed: progress, states, expansion, spacing, resize, cancellation, cleanup.")
