"""Exercise the prototype in real InteractiveMode, including native tool state transitions."""
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
repo = here.parent.parent
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLORTERM"] = "truecolor"
    os.execvp("node", ["node", str(here / "demo.mjs"), *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 120, 0, 0))
screen = pyte.Screen(120, 60)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
status = None
output = bytearray()
screens = {}
before = "--before" in sys.argv
production = "--production" in sys.argv
success_color = "85858a" if production else "4dff88"
low_power = "--lowpower" in sys.argv
mcp_only = "--mcp-only" in sys.argv
target = "mcp" if mcp_only else "all"
call_count = 1 if mcp_only else 5
checking_markers = True

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
        if checking_markers and not before:
            assert "77777d" not in marker_colors(), f"Visible tool markers must not turn gray, including argument generation\n{view()}"
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value

def wait(predicate, label, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
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

def color_at(text, offset=0):
    for y, line in enumerate(screen.display):
        if text in line:
            return screen.buffer[y][line.index(text) + offset].fg
    raise AssertionError(f"Missing text: {text}\n{view()}")

def marker_colors():
    colors = []
    for y, line in enumerate(screen.display):
        prefixes = ("$ Bash", "@ ", "~ Writing", "~ Editing", "~ Write", "~ Edit", "~ Added", "⌁ Call") if production else ("⏺ ",)
        stripped = line.lstrip()
        if stripped.startswith("├─ "):
            stripped = stripped[3:]
        for prefix in prefixes:
            if stripped.startswith(prefix):
                colors.append(screen.buffer[y][line.index(prefix)].fg)
                break
    return colors

try:
    wait(lambda: "Fixture finished." in view(), "initial success fixtures")
    settle()
    assert "Extension issues" not in view(), view()
    screens["success"] = view()
    if not before:
        colors = marker_colors()
        assert len(colors) >= call_count, colors
        assert colors[-call_count:] == [success_color] * call_count, colors
        for content in (["Found 2 results"] if mcp_only else ["export const status", "Found 2 results"] if low_power else ["Test Files", "export const status", "Found 2 results"]):
            assert color_at(content) == "d6d6d6", (content, color_at(content))
        if not mcp_only:
            assert color_at("1 more lines") == "77777d"
            assert color_at("│   1", 4) == "77777d"
        assert color_at("└ Found") == "77777d"
        os.write(fd, b"\x0f")
        settle()
        assert color_at("Found 2 results") == "d6d6d6"
        os.write(fd, b"\x0f")
        settle()
    for outcome in ["error", "interrupted", "timeout"]:
        command(f"/demo {target} hold")
        wait(lambda: "Calling fixture / search" in view() and (mcp_only or "Reading…" in view()), "held tools")
        settle()
        screens[f"running-{outcome}"] = view()
        if not before:
            colors = marker_colors()
            assert len(colors) >= call_count and colors[-call_count:] == ["ffe66d"] * call_count, colors
        frozen = view()
        settle(1.1)
        if mcp_only:
            assert marker_colors()[-call_count:] == ["ffe66d"] * call_count
        else:
            assert view() == frozen, "Static markers must not animate while held"
        command(f"/finish {outcome}")
        wait(lambda: "Fixture finished." in view().split(f"Fixture: {target} / hold")[-1], f"finish {outcome}")
        settle()
        screens[outcome] = view()
        if not before:
            colors = marker_colors()
            expected = "ff6b6b" if outcome == "error" else "ffe66d"
            expected_colors = [expected] * call_count
            if production and outcome == "timeout" and not mcp_only:
                # File tools have no native timeout contract; unrecognized failures stay red.
                expected_colors = ["ffe66d", "ff6b6b", "ff6b6b", "ff6b6b", "ffe66d"]
            assert len(colors) >= call_count and colors[-call_count:] == expected_colors, colors
    for width in [80, 40, 120]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, width, 0, 0))
        screen.resize(60, width)
        settle(0.6)
        assert "Fixture finished." in view(), view()
        screens[f"width-{width}"] = view()
    os.write(fd, b"\x0f")
    settle()
    screens["expanded"] = view()
    if "--play" in sys.argv:
        os.write(fd, b"\x0f")
        settle()
        command("/play")
        wait(lambda: "Collecting fixture tests…" in view(), "automatic playback progress", 10)
        screens["play-progress"] = view()
        wait(lambda: "(2/4 tests)" in view(), "streaming Bash result")
        wait(lambda: "Playback complete." in view(), "playback finishes")
        settle()
        assert marker_colors()[-5:] == [success_color] * 5
        command("/play batch")
        for tool in ["read", "bash", "edit", "write", "mcp"]:
            label = f"Batch playback: {tool} / mixed"
            wait(lambda: label in view(), f"batch {tool} starts")
            if tool == "read":
                wait(lambda: "Read 3 files" in view(), "native Read grouping")
                screens["batch-read-running"] = view()
            wait(lambda: "Playback frame finished." in view().split(label)[-1], f"batch {tool} finishes")
            colors = marker_colors()[-3:]
            assert colors == [success_color, "ff6b6b", "ffe66d"], (tool, colors, view())
            screens[f"batch-{tool}"] = view()
        wait(lambda: "Playback complete." in view(), "batch playlist finishes")
        settle()
        command("/batch read mixed")
        wait(lambda: "Fixture finished." in view().split("Batch fixture: read / mixed")[-1], "inspect static Read batch")
        os.write(fd, b"\x0f")
        wait(lambda: "▾ Read 3 files" in view(), "expand native Read batch")
        for width in [80, 40, 120]:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, width, 0, 0))
            screen.resize(60, width)
            settle(0.6)
            assert "▾ Read 3 files" in view(), view()
            assert marker_colors()[-3:] == [success_color, "ff6b6b", "ffe66d"]
            screens[f"batch-width-{width}"] = view()
        os.write(fd, b"\x0f")
        settle()
        command("/play mixed")
        wait(lambda: "Collecting fixture tests…" in view().split("Playback: all / mixed")[-1], "replay starts")
        command("/play stop")
        wait(lambda: "Playback stopped." in view(), "stop playback")
        settle(1)
        screens["play-stopped"] = view()
    if production:
        history_tool = "mcp" if mcp_only else "read"
        command(f"/batch {history_tool} mixed")
        wait(lambda: "Fixture finished." in view().split(f"Batch fixture: {history_tool} / mixed")[-1], "production history fixture")
        settle()
        expected = [success_color, "ff6b6b", "ffe66d"]
        assert marker_colors()[-3:] == expected
        command("/fixture-theme light")
        wait(lambda: marker_colors()[-3:] != expected, "theme change repaints group colors")
        screens["light-theme"] = view()
        command("/fixture-theme codex-pi")
        wait(lambda: marker_colors()[-3:] == expected, "restore codex theme")
        command("/reload")
        wait(lambda: "Reloaded" in view(), "reload production renderers")
        settle()
        assert marker_colors()[-3:] == expected, view()
        assert ("Timed out" if mcp_only else "Operation aborted") in view(), view()
        screens["restored-history"] = view()
        if "--restart" in sys.argv:
            command("/quit")
            wait(lambda: "Restored fixture history." in view(), "restart with persisted history")
            settle()
            assert marker_colors()[-3:] == expected, view()
            assert ("Timed out" if mcp_only else "Operation aborted") in view(), view()
            screens["restarted-history"] = view()
    command("/quit")
    wait(lambda: status is not None, "shutdown")
    assert os.waitstatus_to_exitcode(status) == 0
    mode = "-".join(arg.lstrip("-") for arg in sys.argv[1:]) or "regular"
    (repo / ".tmp" / f"tool-status-smoke-{mode}.json").write_text(json.dumps({"passed": True, "pid": pid, "screens": screens}, ensure_ascii=False, indent=2))
    print(json.dumps({"passed": True, "mode": mode, "pid": pid}))
finally:
    checking_markers = False
    (repo / ".tmp" / "tool-status-last.ansi").write_bytes(output)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        end = time.monotonic() + 5
        while status is None and time.monotonic() < end:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
