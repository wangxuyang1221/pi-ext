"""Exercise production Goal and codex-ui in Pi 0.87.0 InteractiveMode."""
import codecs
import errno
import fcntl
import gzip
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import pyte

repo = Path(__file__).resolve().parents[3]
mode = "fullscreen" if "--fullscreen" in sys.argv else "regular"
root = Path(tempfile.mkdtemp(prefix="goal-ui-pty-", dir=repo / ".tmp"))
evidence = repo / "adventure/39/evidence/implementation"
status = None
pid = fd = None
screens = {}
processes = []
raw = bytearray()


def start(resume=False):
    global pid, fd, status, screen, stream, decoder
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        env = {key: value for key, value in os.environ.items() if key in ["PATH", "SHELL", "LANG", "LC_ALL"]}
        env.update({"GOAL_UI_TEST_ROOT": str(root), "TERM": "xterm-256color", "COLORTERM": "truecolor"})
        args = ["node", "extensions/goal/__tests__/tool-ui-runtime.mjs", "--tui"]
        if mode == "fullscreen": args.append("--fullscreen")
        if resume: args.append("--resume")
        os.execvpe("node", args, env)
    processes.append(pid)
    status = None
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 64, 120, 0, 0))
    screen = pyte.Screen(120, 64)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")


def view(): return "\n".join(line.rstrip() for line in screen.display)


def pump():
    global status
    ready, _, _ = select.select([fd], [], [], 0.04)
    if ready:
        try: chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO: raise
            chunk = b""
        raw.extend(chunk)
        stream.feed(decoder.decode(chunk))
    if status is None:
        done, code = os.waitpid(pid, os.WNOHANG)
        if done: status = code


def wait(predicate, label, timeout=35):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        pump()
        if predicate(): return
        if status is not None: break
    raise AssertionError(f"Failed: {label}\n{view()}")


def settle(duration=0.4):
    end = time.monotonic() + duration
    while time.monotonic() < end: pump()


def command(text): os.write(fd, text.encode() + b"\r")


def events():
    path = root / "events.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def scenario(name):
    count = sum(e["event"] == "settled" for e in events())
    command(f"/probe {name}")
    wait(lambda: sum(e["event"] == "settled" for e in events()) > count, name)
    settle()


def marker(label):
    for y in reversed(range(screen.lines)):
        line = screen.display[y]
        if label in line and "⏺" in line: return screen.buffer[y][line.index("⏺")].fg
    return None


def snapshot(name):
    assert "Extension issues" not in view(), view()
    screens[name] = view()


def quit():
    command("/quit")
    wait(lambda: status is not None, "exit")
    assert os.waitstatus_to_exitcode(status) == 0, status
    os.close(fd)


passed = False
try:
    start()
    wait(lambda: "Scenario finished: empty" in view(), "initial empty goal")
    settle()
    assert "No goal" in view() and marker("Read goal") == "4dff88", view()
    snapshot("empty")
    scenario("error")
    assert "Cannot update goal" in view() and marker("Update goal failed") == "ff6b6b", view()
    snapshot("error")
    scenario("mixed")
    for label in ["Bash(", "Created goal", "Read goal", "Updated goal", "ui-note.txt"]: assert label in view(), (label, view())
    assert marker("Updated goal") == "4dff88", view()
    assert "tokens ·" in view() and '"threadId"' not in view(), view()
    assert (root / "workspace/ui-note.txt").read_text() == "After edit\n"
    snapshot("mixed-summary")
    os.write(fd, b"\x0f")
    wait(lambda: "Remaining:" in view() and "Thread:" in view(), "native expansion")
    snapshot("expanded")
    os.write(fd, b"\x0f"); settle()
    command("/probe-save"); wait(lambda: "Evidence saved" in view(), "save")
    initial_results = [e for e in events() if e["event"] == "tool-result"]
    quit()
    start(resume=True)
    wait(lambda: "Updated goal" in view(), "restart history")
    settle(); snapshot("restarted")
    assert "Created goal · Active" in view() and "Updated goal · Complete" in view(), view()
    ready_count = sum(e["event"] == "ready" for e in events())
    command("/reload")
    wait(lambda: sum(e["event"] == "ready" for e in events()) > ready_count, "reload")
    settle(); snapshot("reloaded")
    assert "Created goal · Active" in view() and "Updated goal · Complete" in view(), view()
    assert [e for e in events() if e["event"] == "tool-result"] == initial_results
    scenario("long")
    assert "LONG-GOAL-END" not in view(), view()
    for width in [40, 80, 120]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 64, width, 0, 0))
        screen.resize(64, width); settle(0.7)
        assert "Updated goal" in view(), view()
        snapshot(f"width-{width}")
    os.write(fd, b"\x0f")
    wait(lambda: "LONG-GOAL-END" in view(), "expanded multiline objective")
    snapshot("long-expanded")
    os.write(fd, b"\x0f"); settle()
    for name in ["paused", "blocked"]:
        scenario(name)
        assert f"Updated goal · {name.title()}" in view() and marker("Updated goal") == "4dff88", view()
        snapshot(name)
    assert "tokens ·" in view(), view()
    os.write(fd, b"\x0f"); wait(lambda: "No budget" in view() and "Unbounded" in view(), "unbounded details")
    snapshot("unbounded-expanded"); os.write(fd, b"\x0f"); settle()
    scenario("complete"); scenario("budget"); scenario("read")
    assert "Read goal · Budget limited" in view() and marker("Read goal") == "4dff88", view()
    snapshot("budget-limited")
    scenario("complete"); scenario("incomplete"); scenario("read")
    assert "Observed usage only" in view(), view()
    snapshot("incomplete")
    scenario("complete"); scenario("quota"); scenario("read")
    assert "Read goal · Usage limited" in view() and marker("Read goal") == "4dff88", view()
    snapshot("usage-limited")
    scenario("complete")
    command("/probe held")
    wait(lambda: "Reading goal" in view(), "pending tool")
    assert marker("Reading goal") == "ffe66d", view()
    snapshot("pending")
    command("/probe-release"); wait(lambda: "Scenario finished: held" in view(), "held tool success"); settle()
    command("/probe-theme light")
    wait(lambda: marker("Read goal") not in [None, "4dff88"], "light theme")
    snapshot("light")
    command("/probe-theme codex-pi")
    wait(lambda: marker("Read goal") == "4dff88", "restored theme")
    before = len([e for e in events() if e["event"] == "tool-result"])
    for _ in range(10): os.write(fd, b"\x0f"); settle(0.08)
    assert len([e for e in events() if e["event"] == "tool-result"]) == before
    command("/probe-save"); wait(lambda: "Evidence saved" in view(), "final save"); quit()
    assert b"\x1b]52;c;YQ==" not in raw, "Clipboard command injected into terminal"
    saved = next(e for e in reversed(events()) if e["event"] == "saved")
    assert saved["networkAttempts"] == 0
    (evidence / f"pty-{mode}-events.json").write_text(json.dumps(events(), ensure_ascii=False, indent=2))
    passed = True
finally:
    if status is None and pid:
        os.killpg(pid, signal.SIGTERM)
        deadline = time.monotonic() + 4
        while status is None and time.monotonic() < deadline: pump()
        if status is None: os.killpg(pid, signal.SIGKILL); os.waitpid(pid, 0)
        os.close(fd)
    (evidence / f"pty-{mode}.ansi.gz").write_bytes(gzip.compress(raw, mtime=0))
    shutil.rmtree(root)
    ports = subprocess.run(["lsof", "-nP", "-a", "-p", ",".join(map(str, processes)), "-iTCP", "-sTCP:LISTEN"], capture_output=True, text=True)
    assert not ports.stdout, ports.stdout
    report = {"passed": passed, "mode": mode, "pids": processes, "rootRemoved": not root.exists(), "listeningPorts": [], "screens": screens}
    (evidence / f"pty-{mode}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({key: value for key, value in report.items() if key != "screens"}))
