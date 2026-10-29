"""Drive the public text-region example through a real, isolated Pi CLI PTY."""
import argparse
import codecs
import copy
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import termios
import time
import pyte

parser = argparse.ArgumentParser()
parser.add_argument("evidence", type=Path)
parser.add_argument("--cli", type=Path, required=True)
parser.add_argument("--mode", choices=["regular", "fullscreen"], default="regular")
parser.add_argument("--original", action="store_true")
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
root = args.evidence.resolve()
assert root.is_relative_to(repo / ".tmp") and not root.exists(), "Use a new worktree .tmp evidence directory"
root.mkdir(parents=True)
runtime = root / "runtime"
for name in ["home", "agent", "workspace", "tmp", "cache"]:
    (runtime / name).mkdir(parents=True)
env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL"] if key in os.environ}
env.update(HOME=str(runtime / "home"), TMPDIR=str(runtime / "tmp"), XDG_CACHE_HOME=str(runtime / "cache"),
           PI_CODING_AGENT_DIR=str(runtime / "agent"), PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1",
           PI_TELEMETRY="0", TERM="xterm-256color", COLORTERM="truecolor", LOCAL_REFRESH_EVIDENCE=str(root))
(runtime / "agent/settings.json").write_text(json.dumps({"quietStartup": True, "theme": "dark", "showHardwareCursor": True,
    "compaction": {"enabled": False}, "cacheWarming": "off", "retry": {"enabled": False}, "doubleEscapeAction": "none"}))
command_line = [str(args.cli.resolve()), "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
                "-e", str(repo / "examples/text-region.ts"), "-e", str(repo / "test-support/fixtures/local-refresh/provider.ts"),
                "--provider", "faux", "--model", "faux-1", "--tui-mode", args.mode]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(runtime / "workspace")
    os.execve(command_line[0], command_line, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
class DualScreen(pyte.Screen):
    """Model the xterm alternate screen used by real renderer switching."""
    main_state = None

    def set_mode(self, *modes, **kwargs):
        if kwargs.get("private") and 1049 in modes:
            if self.main_state is None:
                self.main_state = copy.deepcopy({key: value for key, value in self.__dict__.items() if key != "main_state"})
                self.reset()
            modes = tuple(mode for mode in modes if mode != 1049)
        super().set_mode(*modes, **kwargs)

    def reset_mode(self, *modes, **kwargs):
        if kwargs.get("private") and 1049 in modes:
            if self.main_state is not None:
                columns, lines = self.columns, self.lines
                self.__dict__.update(self.main_state)
                self.main_state = None
                self.resize(lines=lines, columns=columns)
            modes = tuple(mode for mode in modes if mode != 1049)
        super().reset_mode(*modes, **kwargs)

screen = DualScreen(120, 40)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
raw = bytearray()
status = None
checks = []
actions = []
screens = {}

def events(kind):
    path = root / "events.jsonl"
    return [v["data"] for line in path.read_text().splitlines() if line and (v := json.loads(line))["type"] == kind] if path.exists() else []

def view():
    return "\n".join(line.rstrip() for line in screen.display)

def pump():
    global status
    ready, _, _ = select.select([fd], [], [], 0.03)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        raw.extend(data)
        stream.feed(decoder.decode(data))
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value

def wait(predicate, label, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()
        if predicate():
            checks.append(label)
            return
        if status is not None:
            break
    raise AssertionError(f"{label}\n{view()}")

def settle(seconds=0.3):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()

def send(text):
    actions.append({"input": text, "time": time.monotonic()})
    os.write(fd, text.encode())
    settle()

def command(text):
    send("\x15" + text + "\r")

def capture(name):
    rows = [i for i, line in enumerate(screen.display) if "Region demo" in line]
    accent = screen.buffer[rows[-1]][screen.display[rows[-1]].index("Region demo")].fg if rows else None
    screens[name] = {"text": view(), "cursor": {"x": screen.cursor.x, "y": screen.cursor.y}, "accent": accent}

def counters():
    animation = re.findall(r"Region demo (\d+) /", view())
    rate = re.findall(r"\| (\d+) t/s", view())
    return (int(animation[-1]), int(rate[-1])) if animation and rate else None

def terminate(signum, _frame):
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)
passed = False
try:
    wait(lambda: "Trust project folder?" in view() or "Controlled example" in view(), "CLI startup")
    if "Trust project folder?" in view():
        send("\x1b[B\x1b[B\r")
    wait(lambda: "Controlled example" in view() and "Region demo" in view(), "real factory mount")
    assert ("normal fallback" if args.original else "region API") in view(), view()
    wait(lambda: counters() is not None, "complete target frame")
    before = counters()
    wait(lambda: counters() is not None and counters() != before, "80ms animation and footer advancement")
    assert events("start")[-1]["tty"]
    capture("mounted")
    command("/region-demo pause")
    before = counters()
    command("/region-demo animation")
    assert counters() == (before[0] + 1, before[1]), view()
    command("/region-demo footer")
    assert counters() == (before[0] + 1, before[1] + 1), view()
    command("/region-demo both")
    assert counters() == (before[0] + 2, before[1] + 2), view()
    checks.append("independent and same-frame target values")
    command("/region-demo start")
    send("draft-中文-abc")
    send("\x1b[D\x1b[D")
    cursor = (screen.cursor.x, screen.cursor.y)
    before = counters()
    settle(0.6)
    assert counters() != before and (screen.cursor.x, screen.cursor.y) == cursor, view()
    send("X")
    send("\x1b[17~")
    assert events("editor")[-1] == "draft-中文-aXbc", events("editor")
    capture("draft")
    checks.append("draft text and hardware cursor preserved during animation")
    send("\x1b[18~")
    wait(lambda: "REGION OVERLAY" in view(), "overlay opened by real shortcut")
    capture("overlay")
    settle(0.6)
    assert "REGION OVERLAY" in view()
    send("q")
    wait(lambda: bool(events("overlayClosed")), "overlay focus and close")
    send("\x1b[17~")
    assert events("editor")[-1] == "draft-中文-aXbc"
    send("\r")
    wait(lambda: bool(events("settled")), "provider response through real session")
    assert "Response 0" in view()
    for index in range(1, 7):
        completed = len(events("settled"))
        command(f"History growth {index}")
        wait(lambda: len(events("settled")) > completed, f"history growth response {index}")
        wait(lambda: f"Response {index}" in view() and "Controlled example" in view(), f"history growth frame {index}")
    capture("history-grown")
    command("/region-demo height")
    assert "/ 2" in view(), view()
    command("/region-demo height")
    assert "/ 2" not in view(), view()
    checks.append("dynamic row count grows and shrinks")
    for width, height in [(40, 25), (32, 40), (120, 40)]:
        screen.resize(lines=height, columns=width)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
        os.kill(pid, signal.SIGWINCH)
        settle(0.5)
        assert "Region demo" in view(), view()
        capture(f"resize-{width}")
    checks.append("window resize preserves target and input layout")
    command("/fixture-theme")
    wait(lambda: bool(events("theme")), "theme update through extension UI")
    assert "Region demo" in view()
    assert events("theme")[-1]["success"]
    capture("theme")
    assert screens["theme"]["accent"] != screens["mounted"]["accent"], screens["theme"]
    command("/settings")
    send("TUI mode")
    wait(lambda: "TUI mode" in view(), "settings mode selector")
    send("\r")
    settle(0.4)
    send("\x1b")
    settle(0.5)
    assert "Region demo" in view() and "Controlled example" in view(), view()
    assert json.loads((runtime / "agent/settings.json").read_text())["tuiMode"] == ("fullscreen" if args.mode == "regular" else "regular")
    capture("mode-switched")
    before = counters()
    wait(lambda: counters() is not None and counters() != before, "registered targets survive renderer switch")
    command("/settings")
    send("TUI mode\r")
    send("\x1b")
    settle(0.5)
    assert json.loads((runtime / "agent/settings.json").read_text())["tuiMode"] == args.mode
    capture("mode-restored")
    before = counters()
    wait(lambda: counters() is not None and counters() != before, "registered targets survive renderer return")
    command("/region-demo stop")
    settle(0.4)
    assert "Region demo" not in view() and "Controlled example" not in view(), view()
    checks.append("disposed targets do not reappear")
    command("/region-demo start")
    wait(lambda: "Region demo" in view(), "replacement factories mount")
    starts = len(events("start"))
    command("/new")
    wait(lambda: len(events("start")) > starts, "real new-session lifecycle")
    assert "Region demo" in view()
    starts = len(events("start"))
    command("/fixture-reload")
    wait(lambda: len(events("start")) > starts, "real extension reload lifecycle")
    wait(lambda: "Region demo" in view(), "reloaded factories mount")
    capture("reloaded")
    command("/quit")
    wait(lambda: status is not None, "CLI exits without retained animation timer")
    assert os.waitstatus_to_exitcode(status) == 0
    assert events("shutdown")
    passed = True
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        end = time.monotonic() + 5
        while status is None and time.monotonic() < end:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            _, status = os.waitpid(pid, 0)
    os.close(fd)
    listing = subprocess.run(["ps", "-axo", "pid=,pgid=,stat="], capture_output=True, text=True, check=True).stdout
    survivors = [line for line in listing.splitlines() if len(fields := line.split()) >= 3 and fields[1] == str(pid) and not fields[2].startswith("Z")]
    (root / "terminal.ansi").write_bytes(raw)
    (root / "screens.json").write_text(json.dumps(screens, ensure_ascii=False, indent=2))
    (root / "actions.json").write_text(json.dumps(actions, ensure_ascii=False, indent=2))
    shutil.rmtree(runtime)
    result = {"passed": passed, "pid": pid, "exitCode": os.waitstatus_to_exitcode(status), "mode": args.mode, "original": args.original,
              "cli": str(args.cli), "checks": checks, "cleanup": {"processGroupEmpty": not survivors, "survivors": survivors, "runtimeRemoved": not runtime.exists(), "servicesStarted": []}}
    (root / "summary.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    assert not survivors
