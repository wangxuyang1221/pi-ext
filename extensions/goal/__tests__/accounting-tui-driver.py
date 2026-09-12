"""Verify visible usage diagnostics in real InteractiveMode PTY sessions."""
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

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
assert not (root / "events.jsonl").exists(), "Use a fresh fixture directory"
sdk = str(Path(sys.argv[2]).resolve())
source = os.environ.get("GOAL_USAGE_SOURCE", "root")
pid, fd = pty.fork()
if pid == 0:
    os.environ.update({"GOAL_PROBE_ROOT": str(root), "TERM": "xterm-256color", "HOME": str(root), "TMPDIR": str(root)})
    os.execvp("node", ["node", "extensions/goal/__tests__/accounting-tui.mjs", sdk])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 140, 0, 0))
screen = pyte.Screen(140, 60)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
output = bytearray()
status = None
screens = {}
transcript = (root / "terminal.ansi").open("wb")


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
        transcript.write(data)
        transcript.flush()
        stream.feed(decoder.decode(data))
        rendered = view()
        if "Goal usage is incomplete" in rendered:
            screens.setdefault("warning", rendered)
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value


def events():
    path = root / "events.jsonl"
    return path.read_text() if path.exists() else ""


def wait(predicate, label):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        pump()
        if predicate():
            return
        if status is not None:
            raise AssertionError(f"Exited before {label}: {status}")
    raise TimeoutError(label)


def settle_ui():
    deadline = time.monotonic() + 0.4
    while time.monotonic() < deadline:
        pump()


def command(value):
    os.write(fd, value.encode() + b"\r")


try:
    wait(lambda: '"event":"ready"' in events(), "ready")
    settle_ui()
    command("/goal Persistent TUI accounting")
    wait(lambda: '"settledCount":1' in events(), "initial settled")
    settle_ui()
    assert "warning" in screens, "Usage warning must render in a terminal frame"
    if source == "child":
        assert "managed child" in screens["warning"]
        assert '"event":"child-closed"' in events()
    command("/goal")
    wait(lambda: "Usage is incomplete; tokens shown are observed usage only." in view(), "query warning")
    screens["query"] = view()
    os.write(fd, b"\x1b")
    settle_ui()
    command("/goal edit")
    wait(lambda: "Edit goal" in view(), "native editor")
    settle_ui()
    os.write(fd, b"\x05 edited\r")
    wait(lambda: b"Goal updated." in output, "saved edit")
    settle_ui()
    command("/reload")
    wait(lambda: '"readyCount":2' in events() and b"Reloaded keybindings" in output, "reload")
    settle_ui()
    command("/goal")
    wait(lambda: "Usage is incomplete; tokens shown are observed usage only." in view(), "reloaded query")
    screens["reloaded-query"] = view()
    os.write(fd, b"\x1b")
    settle_ui()
    command("/goal resume")
    wait(lambda: '"settledCount":2' in events(), "resumed settled")
    settle_ui()
    command("/goal")
    wait(lambda: "Usage is incomplete; tokens shown are observed usage only." in view(), "resumed query")
    screens["resumed-query"] = view()
    os.write(fd, b"\x1b")
    settle_ui()
    command("/accounting-exit")
    wait(lambda: status is not None, "graceful shutdown")
    assert os.waitstatus_to_exitcode(status) == 0
    rows = [json.loads(line) for line in events().splitlines()]
    result = next(row for row in rows if row["event"] == "result")
    assert result["goal"]["tokensUsed"] == 7
    assert result["goal"]["usageIncomplete"] is True
    assert result["goal"]["status"] == "paused"
    assert result["goal"]["objective"].endswith("edited")
    assert result["networkAttempts"] == 0
    tools = [row for row in rows if row["event"] == "tool-result"]
    assert not any(row["isError"] for row in tools)
    reads = [row for row in tools if row["name"] == "get_goal"]
    assert len(reads) == 2
    assert all(row["details"]["usageVisibility"] == "incomplete: reported tokens include only observed usage" for row in reads)
    assert reads[-1]["details"]["goal"]["tokensUsed"] == 7
    (root / "result.json").write_text(json.dumps({**result, "pid": pid, "exited": True, "passed": True}, indent=2))
    print(json.dumps({"versions": result["versions"], "source": source, "pid": pid, "passed": True}))
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(50):
            pump()
            if status is not None:
                break
        if status is None:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            _, status = os.waitpid(pid, 0)
    transcript.close()
    os.close(fd)
    (root / "screens.json").write_text(json.dumps(screens, ensure_ascii=False, indent=2))
    (root / "cleanup.json").write_text(json.dumps({"pid": pid, "exited": True, "status": status}))
