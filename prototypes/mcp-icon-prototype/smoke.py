"""Exercise the real Pi host with offline MCP icon fixtures."""
import codecs
import errno
import fcntl
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
repo = here.parent.parent
before = set((repo / ".tmp").glob("mcp-icon-*"))
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
glyphs = ("⇄", "::") if "--both" in sys.argv else ("⇄",) if "--3" in sys.argv else ("::",) if "--4" in sys.argv else ("»",) if "--chevron" in sys.argv else ("⌘",) if "--command" in sys.argv else ("⌁",)

def view():
    return "\n".join(screen.display)

def markers(symbols=("⇄", "::", "»", "⌘", "⌁")):
    found = []
    for y, line in enumerate(screen.display):
        for glyph in symbols:
            if line.lstrip().startswith(glyph + " "):
                found.append((glyph, screen.buffer[y][line.index(glyph)].fg))
    return found

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
        observed.update(markers(("⇄", "::", "»", "⌘", "⌁", "@", "$", "~")))
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

def command(value):
    os.write(fd, value.encode() + b"\r")

try:
    wait(lambda: "Comparison complete." in view(), "automatic comparison")
    expected = [(glyph, color) for glyph in glyphs for color in ("85858a", "85858a" if glyph in ("»", "⌘", "⌁") else "4dff88", "ff6b6b")]
    assert markers()[-len(expected):] == expected, (markers(), expected)
    assert all((glyph, "ffe66d") in observed for glyph in glyphs), observed
    assert "Extension issues" not in view(), view()
    if glyphs in (("⌘",), ("⌁",)):
        columns = [match.start(1) for line in screen.display
                   if (match := re.match(r"^\s*[@$~⌘⌁]\s+(\S)", line))]
        assert len(columns) >= 7 and len(set(columns)) == 1, (columns, view())
    for glyph in ("@", "$", "~"):
        assert (glyph, "ffe66d") in observed and (glyph, "85858a") in observed, observed
    for label in ("sample.ts", "config.ts", "result.md", "Type check passed"):
        assert label in view(), view()
    roots = [path for path in set((repo / ".tmp").glob("mcp-icon-*")) - before if path.is_dir()]
    assert len(roots) == 1, roots
    workspace = roots[0] / "workspace"
    assert "retries: 3" in (workspace / "src/config.ts").read_text()
    assert "Compare MCP" in (workspace / "docs/result.md").read_text()
    os.write(fd, b"\x0f")
    wait(lambda: "Expanded fixture detail" in view(), "native result expansion")
    os.write(fd, b"\x0f")
    wait(lambda: "Expanded fixture detail" not in view(), "native result collapse")
    screen.resize(lines=65, columns=48)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 65, 48, 0, 0))
    command("/icons")
    wait(lambda: "⌁ Calling" in view(), "narrow wave replay starts")
    wait(lambda: markers()[-3:] == [("⌁", color) for color in ("85858a", "85858a", "ff6b6b")], "narrow wave replay settles")
    assert "retries: 3" in (workspace / "src/config.ts").read_text(), "Replay must reseed edit input"
    command("/quit")
    wait(lambda: status is not None, "clean shutdown")
    assert os.waitstatus_to_exitcode(status) == 0, view()
    assert set((repo / ".tmp").glob("mcp-icon-*")) == before, "Temporary workspace was not removed"
    print("PASS: selected icons, pending/success/error colors, expansion, mixed native tools, narrow wave replay, cleanup")
finally:
    (repo / ".tmp/mcp-icon-last.ansi").write_bytes(raw)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        end = time.monotonic() + 5
        while status is None and time.monotonic() < end:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
