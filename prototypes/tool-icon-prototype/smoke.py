"""Check icon playback in a real Pi PTY, not a reconstructed UI."""
import codecs
import errno
import fcntl
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
repo = here.parent.parent
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ.update(TERM="xterm-256color", COLORTERM="truecolor")
    os.execvp("node", ["node", str(here / "demo.mjs"), *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 65, 120, 0, 0))
screen = pyte.Screen(120, 65)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
status = None
observed = set()
raw = bytearray()
before = "--before" in sys.argv
symbols = "--symbols" in sys.argv and not before

def view():
    return "\n".join(screen.display)

def markers():
    result = []
    for y, line in enumerate(screen.display):
        for glyph in ("⏺",) if before else ("$", "@", "~", "⌕") if symbols else ("⌘", "⚙"):
            if line.lstrip().startswith((glyph, "├─ " + glyph)):
                result.append((glyph, screen.buffer[y][line.index(glyph)].fg))
    return result

def pump():
    global status
    if select.select([fd], [], [], 0.04)[0]:
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        raw.extend(data)
        stream.feed(decoder.decode(data))
        observed.update(markers())
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value

def wait(predicate, label, seconds=40):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()
        if predicate():
            return
        if status is not None:
            break
    raise AssertionError(f"Failed: {label}\n{view()}")

def command(text):
    os.write(fd, text.encode() + b"\r")

try:
    wait(lambda: "Playback complete." in view(), "automatic playback")
    success = "4dff88" if before else "85858a"
    expected = [("⏺", success)] * 5 if before else [("⌘", success)] + [("⚙", success)] * 4
    if symbols:
        expected = [(glyph, "85858a") for glyph in ["$", "@", "~", "~", "⌕"]]
    wait(lambda: markers()[-5:] == expected, "success glyphs and colors")
    assert "Extension issues" not in view(), view()
    if symbols:
        assert ("$", "ffe66d") in observed, observed
        assert ("@", "ffe66d") in observed, observed
    elif not before:
        assert ("⌘", "ffe66d") in observed, observed
        assert ("⚙", "ffe66d") in observed, observed
    command("/demo all hold")
    wait(lambda: "Reading…" in view() and "Calling fixture / search" in view(), "held calls")
    end = time.monotonic() + 0.8
    while time.monotonic() < end:
        pump()
    command("/finish error")
    wait(lambda: "Fixture finished." in view().split("Fixture: all / hold")[-1], "failed calls")
    wait(lambda: len(markers()) >= 5 and all(color == "ff6b6b" for _, color in markers()[-5:]), "failure colors")
    # The final assistant text can render before agent_settled releases the command guard.
    end = time.monotonic() + 0.8
    while time.monotonic() < end:
        pump()
    command("/play batch")
    for tool in ["read", "bash", "edit", "write", "mcp"]:
        label = f"Batch playback: {tool} / mixed"
        wait(lambda: label in view(), f"batch {tool}")
        wait(lambda: "Playback frame finished." in view().split(label)[-1], f"batch {tool} finished")
        glyph = "⏺" if before else "⌘" if tool == "bash" else "⚙"
        if symbols:
            glyph = {"bash": "$", "read": "@", "edit": "~", "write": "~", "mcp": "⌕"}[tool]
        expected_batch = [(glyph, success), (glyph, "ff6b6b"), (glyph, "ffe66d")]
        wait(lambda: markers()[-3:] == expected_batch, f"batch {tool} colors")
    wait(lambda: "Playback complete." in view(), "batch playback completes")
    command("/play")
    wait(lambda: "Collecting fixture tests…" in view().split("Playback: all / success")[-1], "replay")
    command("/play stop")
    wait(lambda: "Playback stopped." in view(), "stop playback")
    command("/quit")
    wait(lambda: status is not None, "shutdown")
    assert os.waitstatus_to_exitcode(status) == 0
    print("PASS: autoplay, icons, colors, grouped playback, replay, stop, shutdown")
finally:
    (repo / ".tmp/tool-icon-last.ansi").write_bytes(raw)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        end = time.monotonic() + 5
        while status is None and time.monotonic() < end:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
