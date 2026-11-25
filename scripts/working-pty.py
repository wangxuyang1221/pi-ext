#!/usr/bin/env -S conda run --no-capture-output -n codex-py312 python
"""Drive the codex-ui Working indicator through a real, isolated Pi CLI PTY."""
import argparse
import codecs
import copy
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import termios
import time
import sys
import pyte

parser = argparse.ArgumentParser()
parser.add_argument("evidence", type=Path)
parser.add_argument("--cli", type=Path, default=Path(__file__).resolve().parents[1] / "node_modules/.bin/pi")
parser.add_argument("--mode", choices=["regular", "fullscreen"], default="regular")
parser.add_argument("--extension", type=Path, help="Installed codex-ui entry for the working journey")
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo / "test-support/fixtures/working"))
from pty_observations import records

root = args.evidence.resolve()
assert root.is_relative_to(repo / ".tmp") and not root.exists(), "Use a new worktree .tmp evidence directory"
root.mkdir(parents=True)
runtime = root / "runtime"
for name in ["home", "agent", "workspace", "tmp", "cache"]:
    (runtime / name).mkdir(parents=True)
env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL"] if key in os.environ}
env.update(HOME=str(runtime / "home"), TMPDIR=str(runtime / "tmp"), XDG_CACHE_HOME=str(runtime / "cache"),
           PI_CODING_AGENT_DIR=str(runtime / "agent"), PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1",
           PI_TELEMETRY="0", TERM="xterm-256color", COLORTERM="truecolor", WORKING_EVIDENCE=str(root))
(runtime / "agent/themes").mkdir()
shutil.copyfile(repo / "themes/codex-pi.json", runtime / "agent/themes/codex-pi.json")
(runtime / "agent/settings.json").write_text(json.dumps({
    "quietStartup": True, "fullscreenCopyOnSelect": False, "theme": "codex-pi", "showHardwareCursor": True,
    "cacheWarming": "off", "doubleEscapeAction": "none",
    "compaction": {"enabled": True, "reserveTokens": 512, "keepRecentTokens": 512},
    "retry": {"enabled": True, "maxRetries": 2, "baseDelayMs": 3000},
}))
(root / "plan.json").write_text(json.dumps({"kind": "idle", "id": "initial"}))
command_line = [str(args.cli.resolve()), "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates",
    "-e", str(args.extension.resolve() if args.extension else repo / "extensions/codex-ui/dist/index.js"),
    "-e", str(repo / "test-support/fixtures/working/working-provider.ts"),
    "--provider", "faux", "--model", "faux-1", "--tui-mode", args.mode]
initial_workspace_empty = not any((runtime / "workspace").iterdir())
pid, fd = pty.fork()
if pid == 0:
    os.chdir(runtime / "workspace")
    os.execve(command_line[0], command_line, env)
(root / "instance.json").write_text(json.dumps({"pid": pid, "command": command_line, "runtime": str(runtime), "startedAt": time.time(), "initialWorkspaceEmpty": initial_workspace_empty}, indent=2))
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
apc_pending = ""
rendering = False
checks = []
actions = []
screens = {}

def events(kind):
    path = root / "events.jsonl"
    return [record["data"] for record in records(path) if record["type"] == kind]

def view():
    return "\n".join(line.rstrip() for line in screen.display)

def pump():
    global status, apc_pending, rendering
    ready, _, _ = select.select([fd], [], [], 0.03)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        raw.extend(data)
        # A pipe read can stop halfway through a synchronized frame. Only inspect
        # the screen after its end marker, just as a supporting terminal presents it.
        rendering = raw.rfind(b"\x1b[?2026h") > raw.rfind(b"\x1b[?2026l")
        # pyte models text cells; retain raw image protocol bytes separately.
        apc_pending += decoder.decode(data)
        while apc_pending:
            start = apc_pending.find("\x1b_")
            if start < 0:
                if apc_pending.endswith("\x1b"):
                    stream.feed(apc_pending[:-1]); apc_pending = "\x1b"
                else:
                    stream.feed(apc_pending); apc_pending = ""
                break
            stream.feed(apc_pending[:start])
            apc_pending = apc_pending[start:]
            end = apc_pending.find("\x1b\\", 2)
            if end < 0:
                break
            apc_pending = apc_pending[end + 2:]
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value

def wait(predicate, label, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()
        if not rendering and predicate():
            checks.append(label)
            return
        if status is not None:
            break
    raise AssertionError(f"{label}\n{view()}")

def settle(seconds=0.3):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline or rendering:
        pump()
        if time.monotonic() > deadline + 2:
            raise AssertionError("Synchronized frame did not finish")

def send(text):
    actions.append({"input": text, "time": time.monotonic(), "rawBytes": len(raw)})
    os.write(fd, text.encode())
    settle()

def command(text):
    send("\x15" + text + "\r")

def capture(name):
    screens[name] = {"text": view(), "cursor": {"x": screen.cursor.x, "y": screen.cursor.y}, "synchronizedFrameComplete": not rendering, "rawBytes": len(raw)}

def terminate(signum, _frame):
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)
passed = False
try:
    from working_journey import run
    run(globals())
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
    artifacts = root / "artifacts"
    artifacts.mkdir()
    for name in ["workspace", "agent"]:
        shutil.copytree(runtime / name, artifacts / name)
    event_archive_error = None
    if not survivors:
        try:
            records(root / "events.jsonl", final=True)
        except ValueError as error:
            passed = False
            event_archive_error = str(error)
        shutil.rmtree(runtime)
    result = {"passed": passed, "pid": pid, "exitCode": os.waitstatus_to_exitcode(status), "mode": args.mode,
              "cli": str(args.cli), "checks": checks, "cleanup": {"processGroupEmpty": not survivors, "survivors": survivors, "runtimeRemoved": not runtime.exists(), "servicesStarted": []}}
    if event_archive_error is not None:
        result["eventArchiveError"] = event_archive_error
    (root / "summary.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    assert not survivors
if event_archive_error is not None:
    raise ValueError(event_archive_error)
