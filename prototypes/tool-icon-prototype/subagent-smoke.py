"""Run the subagent fixture in the real Pi terminal without spawning workers."""
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
pid, fd = pty.fork()
if pid == 0:
    os.environ.update(TERM="xterm-256color", COLORTERM="truecolor")
    os.execvp("node", ["node", str(here / "demo.mjs"), "--symbols", "--subagent", *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 90, 140, 0, 0))
screen = pyte.Screen(140, 90)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
status = None
observed = set()

def view():
    return "\n".join(screen.display)

def colors():
    return [screen.buffer[y][line.index("󱙺")].fg for y, line in enumerate(screen.display) if line.lstrip().startswith("󱙺 ")]

def pump():
    global status
    if select.select([fd], [], [], 0.05)[0]:
        try:
            stream.feed(decoder.decode(os.read(fd, 65536)))
        except OSError as error:
            if error.errno != errno.EIO:
                raise
        observed.update(colors())
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value

def wait(predicate, label):
    end = time.monotonic() + 40
    while time.monotonic() < end:
        pump()
        if predicate():
            return
        if status is not None:
            break
    raise AssertionError(f"{label}\n{view()}")

def command(text):
    end = time.monotonic() + 0.8
    while time.monotonic() < end:
        pump()
    os.write(fd, text.encode() + b"\r")

try:
    wait(lambda: "Subagent playback complete." in view(), "autoplay")
    wait(lambda: colors()[-6:] == ["85858a", "ff6b6b", "85858a", "85858a", "ffe66d", "85858a"], "mixed colors")
    assert "ffe66d" in observed, observed
    assert "Extension issues" not in view(), view()
    os.write(fd, b"\x0f")
    wait(lambda: "No real worker was started." in view(), "expand fixture details")
    os.write(fd, b"\x0f")
    for mode, color in [("success", "85858a"), ("error", "ff6b6b")]:
        command(f"/agents {mode}")
        wait(lambda: "Subagent playback complete." in view().split(f"Subagent fixture: {mode}")[-1] and f"Subagent fixture: {mode}" in view(), mode)
        wait(lambda: colors()[-6:] == [color] * 6, f"{mode} colors")
    for width in [40, 80, 140]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 90, width, 0, 0))
        screen.resize(90, width)
        end = time.monotonic() + 0.8
        while time.monotonic() < end:
            pump()
        assert colors()[-6:] == ["ff6b6b"] * 6, view()
    if "--production" in sys.argv:
        command("/fixture-theme light")
        wait(lambda: len(colors()) >= 6 and colors()[-6:] != ["ff6b6b"] * 6, "theme repaint")
        command("/fixture-theme codex-pi")
        wait(lambda: colors()[-6:] == ["ff6b6b"] * 6, "restore theme")
        command("/reload")
        wait(lambda: "Reloaded" in view(), "reload")
        assert colors()[-6:] == ["ff6b6b"] * 6, view()
        if "--restart" in sys.argv:
            command("/quit")
            wait(lambda: "Restored fixture history." in view(), "persisted history")
            assert colors()[-6:] == ["ff6b6b"] * 6, view()
    command("/quit")
    wait(lambda: status is not None, "shutdown")
    assert os.waitstatus_to_exitcode(status) == 0
    print("PASS: subagent autoplay, states, expansion, replay, resize, cleanup; mode=" + " ".join(sys.argv[1:]))
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
