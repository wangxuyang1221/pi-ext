#!/usr/bin/env python3
"""Drive production extension commands through the installed Pi CLI and a PTY."""
import codecs
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import stat
import shutil
import struct
import sys
import termios
import time
import tty
import pyte
from event_records import read_records

repo = Path(__file__).resolve().parents[4]
case, scratch, evidence, *recipe_args = sys.argv[1:]
root, evidence = Path(scratch), Path(evidence)
recipe = json.loads(Path(recipe_args[0]).read_text()) if recipe_args else {}
interactive = case.startswith("explore:")
assert case in {"explore:codex-ui", "journey:codex-ui"}, f"Unknown journey: {case}"
pid, fd, status = None, None, None
pids, launches = [], []
raw, actions, snapshots = bytearray(), [], {}
cleanup_errors = []
archive_skipped = []
original_terminal = None
forward_terminal_input = False

def interrupted(signum, _frame):
    raise InterruptedError(f"Verification interrupted by signal {signum}")

signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)

def expand(value):
    for name, path in [("root", root), ("repo", repo), ("evidence", evidence)]:
        value = value.replace("${" + name + "}", str(path))
    return value

def confined(base, name):
    path = (base / name).resolve()
    assert path.is_relative_to(base.resolve()), f"Path escapes isolated root: {name}"
    return path

def copytree(source, target):
    def skip_special(directory, names):
        skipped = []
        for name in names:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                skipped.append(name)
                archive_skipped.append(str(path))
        return skipped
    shutil.copytree(source, target, dirs_exist_ok=True,
                    ignore=skip_special)

def seed(items):
    for item in items:
        path = confined(root, item["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        if "source" in item:
            source = confined(repo, item["source"])
            if source.is_dir():
                copytree(source, path)
            else:
                shutil.copyfile(source, path)
        elif "json" in item:
            path.write_text(expand(json.dumps(item["json"], ensure_ascii=False)))
        else:
            path.write_text(expand(item.get("text", "")))
        actions.append({"seed": item["path"]})

for name in ["workspace", "sessions", "agent"]:
    (root / name).mkdir(exist_ok=True)
settings = {"quietStartup": True, "defaultProjectTrust": "never", "compaction": {"enabled": False}, "retry": {"enabled": False}, "cacheWarming": "off"}
settings.update(recipe.get("settings", {}))
(root / "agent/settings.json").write_text(json.dumps(settings))
env = dict(os.environ, PI_VERIFY_ROOT=str(root), TERM="xterm-256color")
protected_env = {"HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PI_CODING_AGENT_DIR", "TMPDIR", "TMP", "TEMP", "PI_VERIFY_ROOT", "PI_VERIFY_EVIDENCE", "PI_VERIFY_SCRATCH"}
assert not any(key in protected_env or key.startswith("XDG_") for key in recipe.get("env", {})), "Recipe env must preserve isolated directories"
env.update({key: expand(str(value)) for key, value in recipe.get("env", {}).items()})
args = ["node", str(repo / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
        "--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates",
        "--session-dir", str(root / "sessions"), "--provider", recipe.get("providerName", "faux"), "--model", recipe.get("model", "faux-1")]
args.extend(["-e", str(repo / "extensions/codex-ui/dist/index.js")])
provider = confined(repo, recipe["provider"]) if "provider" in recipe else Path(__file__).with_name("command-provider.ts")
args.extend(["-e", str(provider)])
args.extend(expand(arg) for arg in recipe.get("cliArgs", []))
(root / "agent/themes").mkdir(exist_ok=True)
shutil.copyfile(repo / "themes/codex-pi.json", root / "agent/themes/codex-pi.json")
seed(recipe.get("seed", []))
if "responses" in recipe:
    (root / "responses.json").write_text(json.dumps(recipe["responses"]))

def start(extra=None):
    global pid, fd, status, screen, stream, decoder
    command = [*args, *(extra or [])]
    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGTERM, signal.SIGINT])
    pid, fd = pty.fork()
    if pid == 0:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
        os.chdir(root / "workspace")
        os.execvpe(command[0], command, env)
    pids.append(pid)
    launches.append(command)
    status = None
    (evidence / "owners.json").write_text(json.dumps({"driverPid": os.getpid(), "pids": pids, "currentPid": pid}))
    rows, columns = recipe.get("rows", 50), recipe.get("columns", 140)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    screen = pyte.Screen(columns, rows)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)

def view():
    return "\n".join(line.rstrip() for line in screen.display)

def records(*, final=False):
    return read_records(root / "events.jsonl", final=final)

def forward_input():
    if not select.select([sys.stdin], [], [], 0)[0]:
        return
    data = os.read(sys.stdin.fileno(), 65536)
    if not data:
        raise EOFError("Terminal input closed; exit with /quit")
    actions.append({"at": time.monotonic(), "bytes": data.hex()})
    snapshots[f"before-input-{len(actions)}"] = view()
    os.write(fd, data)

def relay_output():
    if select.select([fd], [], [], 0.05)[0]:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        raw.extend(chunk)
        if interactive:
            os.write(sys.stdout.fileno(), chunk)
        if not interactive and b"\x1b[6n" in chunk:
            os.write(fd, b"\x1b[1;1R")
        stream.feed(decoder.decode(chunk))

def pump():
    global status
    relay_output()
    if status is None:
        done, result = os.waitpid(pid, os.WNOHANG)
        if done:
            status = result
    if forward_terminal_input and status is None:
        forward_input()

def wait(predicate, label):
    deadline = time.monotonic() + recipe.get("timeoutSeconds", 30)
    while time.monotonic() < deadline:
        pump()
        if predicate():
            snapshots[label] = view()
            return
        if status is not None:
            break
    raise AssertionError(f"{label}\n{view()}")

def send(text):
    actions.append({"at": time.monotonic(), "text": text})
    os.write(fd, text.encode() + b"\r")

def keys(data, label):
    actions.append({"at": time.monotonic(), "keys": label})
    os.write(fd, data)

def condition(spec):
    if isinstance(spec, str):
        spec = {"screenIncludes": spec}
    text = view()
    for key, value in spec.items():
        if key in ["screenIncludes", "screenExcludes"]:
            values = value if isinstance(value, list) else [value]
            if any((expand(item) not in text) if key == "screenIncludes" else (expand(item) in text) for item in values):
                return False
        elif key == "eventType":
            matches = [event for event in records() if event.get("type") == value]
            if "eventContains" in spec:
                matches = [event for event in matches if expand(spec["eventContains"]) in json.dumps(event, ensure_ascii=False)]
            if len(matches) < spec.get("eventCount", 1):
                return False
        elif key == "file":
            path = confined(root, expand(value))
            if path.exists() is not spec.get("exists", True):
                return False
            if path.exists() and "text" in spec and path.read_text() != expand(spec["text"]):
                return False
            if path.exists() and "json" in spec and json.loads(path.read_text()) != spec["json"]:
                return False
        elif key == "processExited":
            if (status is not None) is not value:
                return False
        elif key not in ["eventCount", "eventContains", "exists", "text", "json"]:
            raise AssertionError(f"Unknown condition: {key}")
    assert spec, "An empty condition does not verify behavior"
    return True


def drive(steps):
    global fd
    keymap = {"enter": b"\r", "escape": b"\x1b", "up": b"\x1b[A", "down": b"\x1b[B", "left": b"\x1b[D", "right": b"\x1b[C", "tab": b"\t", "ctrl-c": b"\x03", "ctrl-d": b"\x04", "ctrl-o": b"\x0f", "backspace": b"\x7f"}
    for index, step in enumerate(steps):
        assert len(step) == 1, f"Each action needs exactly one operation: {step}"
        operation, value = next(iter(step.items()))
        label = f"action-{len(actions)}-{index}-{operation}"
        if operation == "send":
            send(expand(value))
        elif operation == "keys":
            names = value if isinstance(value, list) else [value]
            keys(b"".join(keymap[name.lower()] for name in names), " ".join(names))
        elif operation == "bytes":
            keys(bytes.fromhex(value), value)
        elif operation == "wait":
            actions.append({"wait": value})
            wait(lambda: condition(value), label)
        elif operation == "expect":
            actions.append({"expect": value})
            assert condition(value), f"{label}: {value}\n{view()}"
            snapshots[label] = view()
        elif operation == "snapshot":
            snapshots[value] = view()
            actions.append({"snapshot": value})
        elif operation == "seed":
            seed(value)
        elif operation == "capture":
            source = confined(root, value["path"])
            target = confined(evidence, value["as"])
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                copytree(source, target)
            else:
                shutil.copyfile(source, target)
            actions.append({"capture": value})
        elif operation == "restart":
            snapshots[label] = view()
            if status is None:
                send("/quit")
                wait(lambda: status is not None, label + "-exited")
            assert os.waitstatus_to_exitcode(status) == 0, "Restart requires a clean previous exit"
            os.close(fd)
            fd = None
            extra = [expand(arg) for arg in value.get("cliArgs", [])]
            resume = value.get("resume")
            if resume:
                if resume == "latest":
                    sessions = list((root / "sessions").rglob("*.jsonl"))
                    assert sessions, "No session to resume"
                    session = max(sessions, key=lambda path: path.stat().st_mtime_ns)
                else:
                    session = confined(root, expand(resume))
                extra.extend(["--session", str(session)])
            ready_count = sum(event.get("type") == "ready" for event in records(final=True))
            start(extra)
            actions.append({"restart": value, "pid": pid, "command": launches[-1]})
            wait(lambda: condition(value.get("ready", recipe.get("ready", {"eventType": "ready", "eventCount": ready_count + 1}))), label + "-ready")
        else:
            raise AssertionError(f"Unknown action: {operation}")

passed = False
try:
    if interactive:
        original_terminal = termios.tcgetattr(sys.stdin.fileno())
        # Capability queries can arrive before the extension's ready event.
        tty.setraw(sys.stdin.fileno())
        forward_terminal_input = True
    start()
    wait(lambda: condition(recipe.get("ready", {"eventType": "ready"})), "ready")
    assert "Extension issues" not in view(), view()
    if recipe.get("actions"):
        drive(recipe["actions"])
    if interactive:
        while status is None:
            pump()
        assert status is not None and os.waitstatus_to_exitcode(status) == 0, "Exit with /quit"
    if not interactive and status is None:
        send("/quit")
        wait(lambda: status is not None, "exited")
    assert os.waitstatus_to_exitcode(status) == 0, status
    passed = True
finally:
    # Ignore a second termination request while collecting proof and reaping owned PTYs.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    forward_terminal_input = False
    try:
        if pid is not None and status is None:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            deadline = time.monotonic() + 2
            while status is None and time.monotonic() < deadline:
                pump()
            if status is None:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                _, status = os.waitpid(pid, 0)
        # A leader may have exited while a tool process still owns its PTY group.
        for owned in pids:
            try:
                os.killpg(owned, signal.SIGKILL)
            except ProcessLookupError:
                pass
    except Exception as error:
        cleanup_errors.append({"stage": "process-stop", "error": str(error)})
    if fd is not None:
        try:
            # Drain bytes emitted during shutdown before closing the master.
            for _ in range(3):
                pump()
            os.close(fd)
        except Exception as error:
            cleanup_errors.append({"stage": "terminal-close", "error": str(error)})
    if original_terminal is not None:
        try:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, original_terminal)
        except Exception as error:
            cleanup_errors.append({"stage": "terminal-restore", "error": str(error)})
    stopped = []
    for owned in pids:
        try:
            os.kill(owned, 0)
            stopped.append(False)
        except ProcessLookupError:
            stopped.append(True)
    try:
        (evidence / "terminal.ansi").write_bytes(raw)
    except Exception as error:
        cleanup_errors.append({"stage": "terminal-archive", "error": str(error)})
    # Every copy is independent so one bad path cannot suppress the remaining proof.
    for name in ["home", "agent", "sessions", "workspace"]:
        try:
            if (root / name).exists():
                copytree(root / name, evidence / name)
        except Exception as error:
            cleanup_errors.append({"stage": f"archive-{name}", "error": str(error)})
    try:
        event_log = records(final=all(stopped))
    except ValueError as error:
        passed = False
        event_log = []
        cleanup_errors.append({"stage": "event-archive", "error": str(error)})
    (evidence / "journey.json").write_text(json.dumps({"case": case, "passed": passed if not interactive else None, "completed": passed, "pid": pid, "pids": pids, "driverPid": os.getpid(), "processStopped": all(stopped),
        "command": args, "launches": launches, "actions": actions, "screens": snapshots, "events": event_log, "cleanupErrors": cleanup_errors, "archiveSkipped": sorted(set(archive_skipped))}, ensure_ascii=False, indent=2))
    print(json.dumps({"case": case, "passed": passed, "processStopped": all(stopped), "evidence": str(evidence)}))
    assert all(stopped), "Owned Pi process still exists"
    assert not cleanup_errors, cleanup_errors
