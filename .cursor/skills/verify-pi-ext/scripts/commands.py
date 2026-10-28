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
import shutil
import struct
import sys
import termios
import time
import tty
import pyte

repo = Path(__file__).resolve().parents[4]
case, scratch, evidence = sys.argv[1:]
root, evidence = Path(scratch), Path(evidence)
interactive = case.startswith("explore:")
extension = case.split(":", 1)[1] if interactive else {"metadata": "codex-compact", "metadata-project": "codex-compact", "fast": "openai-fast-mode", "permissions": "permissions"}[case]
for name in ["workspace", "sessions"]:
    (root / name).mkdir(exist_ok=True)
(root / "agent/settings.json").write_text(json.dumps({"quietStartup": True, "defaultProjectTrust": "never", "compaction": {"enabled": False}, "retry": {"enabled": False}, "cacheWarming": "off"}))
env = dict(os.environ, PI_VERIFY_ROOT=str(root), PI_PERMISSIONS_MODE="default", TERM="xterm-256color")
args = ["node", str(repo / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes",
        "--session-dir", str(root / "sessions"), "--provider", "faux", "--model", "faux-1",
        "-e", str(repo / f"extensions/{extension}/{'src/index.ts' if extension == 'codex-search' else 'dist/index.js'}"), "-e", str(Path(__file__).with_name("command-provider.ts"))]
if interactive and extension == "skill-mentions":
    args.remove("--no-skills")
if interactive and extension == "codex-ui":
    args.remove("--no-themes")
    (root / "agent/themes").mkdir(exist_ok=True)
    shutil.copyfile(repo / "themes/codex-pi.json", root / "agent/themes/codex-pi.json")
project_config = root / "workspace/.pi/pi-codex-compact.json"
project_bytes = json.dumps({"metadataClientVersion": "0.158.0", "projectSentinel": "unchanged"})
if case == "metadata-project":
    project_config.parent.mkdir(exist_ok=True)
    project_config.write_text(project_bytes)
    # Trust only this freshly seeded, isolated workspace for this process.
    args.append("--approve")
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root / "workspace")
    os.execvpe(args[0], args, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 140, 0, 0))
screen = pyte.Screen(140, 50)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
raw, actions, snapshots = bytearray(), [], {}
status = None

def view():
    return "\n".join(line.rstrip() for line in screen.display)

def records():
    path = root / "events.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

def pump():
    global status
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
        if b"\x1b[6n" in chunk:
            os.write(fd, b"\x1b[1;1R")
        stream.feed(decoder.decode(chunk))
    if status is None:
        done, result = os.waitpid(pid, os.WNOHANG)
        if done:
            status = result

def wait(predicate, label):
    deadline = time.monotonic() + 30
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

def saved(path):
    return json.loads(path.read_text()) if path.exists() else {}

passed = False
def interrupted(signum, _frame):
    raise InterruptedError(f"Verification interrupted by signal {signum}")

signal.signal(signal.SIGTERM, interrupted)
try:
    wait(lambda: any(item["type"] == "ready" for item in records()), "ready")
    assert "Extension issues" not in view(), view()
    if interactive:
        original = termios.tcgetattr(sys.stdin.fileno())
        tty.setraw(sys.stdin.fileno())
        try:
            while status is None:
                pump()
                if select.select([sys.stdin], [], [], 0.05)[0]:
                    data = os.read(sys.stdin.fileno(), 65536)
                    if not data:
                        break
                    actions.append({"at": time.monotonic(), "bytes": data.hex()})
                    snapshots[f"before-input-{len(actions)}"] = view()
                    os.write(fd, data)
        finally:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, original)
        assert status is not None and os.waitstatus_to_exitcode(status) == 0, "Exit with /quit"
    elif case in ["metadata", "metadata-project"]:
        config = root / "agent/pi-codex-compact.json"
        override = "Project override remains active: 0.158.0"
        flattened = lambda: " ".join(view().split())
        complete = lambda: "Usage: /codex-metadata [version <major.minor.patch>|reset]" in flattened()
        send("/codex-metadata")
        wait(lambda: "Effective metadata client version:" in view() and complete(), "status")
        assert not config.exists(), "Status must not create configuration"
        if case == "metadata-project":
            assert "0.158.0 (project," in flattened() and override in flattened(), view()
        send("/codex-metadata version 0.157.0")
        wait(lambda: saved(config).get("metadataClientVersion") == "0.157.0" and "Saved metadata" in view() and complete(), "saved")
        if case == "metadata-project":
            assert override in flattened(), view()
        snapshots["config-saved"] = config.read_text()
        config.write_text(json.dumps({**saved(config), "autoCompactTokenLimit": 12345, "sentinel": {"keep": True}}))
        snapshots["config-seeded"] = config.read_text()
        send("/codex-metadata reset")
        wait(lambda: "Reset global metadata" in view() and "metadataClientVersion" not in saved(config) and complete(), "reset")
        snapshots["config-reset"] = config.read_text()
        assert saved(config) == {"autoCompactTokenLimit": 12345, "sentinel": {"keep": True}}
        if case == "metadata-project":
            assert override in flattened(), view()
            assert project_config.read_text() == project_bytes
        before_bytes = config.read_bytes()
        for index, invalid in enumerate(["version latest", "version 0.157.0-beta", "version 01.2.3", "version 0.157.0 extra", "reset now", "--project"]):
            # Each invalid command appends a new error notification. Keep pyte's
            # state because Pi redraws only changed terminal cells.
            error_count = flattened().count("Error: Usage: /codex-metadata")
            send("/codex-metadata " + invalid)
            wait(lambda: flattened().count("Error: Usage: /codex-metadata") > error_count and complete(), f"invalid-{index}")
            assert config.read_bytes() == before_bytes, invalid
            if case == "metadata-project":
                assert project_config.read_text() == project_bytes, invalid
        assert not any(item["type"] == "request" for item in records()), "Metadata command must not ask the model"
    elif case == "fast":
        config = root / "agent/extensions/pi-openai-fast-mode/config.json"
        wait(lambda: config.exists(), "config-loaded")
        for command, enabled in [("on", True), ("off", False), ("toggle", True), ("", False)]:
            send(("/fast " + command).strip())
            wait(lambda: saved(config).get("enabled") is enabled, f"fast-{command or 'bare'}")
            snapshots[f"config-{command or 'bare'}"] = config.read_text()
    else:
        count = lambda: sum(item["type"] == "settled" for item in records())
        before = count()
        send("WRITE_PROOF denied")
        wait(lambda: "Allow Pi to run write?" in view(), "approval-deny")
        keys(b"\x1b[B\x1b[B\r", "Down Down Enter: Deny")
        wait(lambda: count() > before, "denied-settled")
        assert not (root / "workspace/proof.txt").exists(), "Denied write created a file"
        before = count()
        send("WRITE_PROOF allowed")
        wait(lambda: "Allow Pi to run write?" in view(), "approval-allow")
        keys(b"\r", "Enter: Allow once")
        wait(lambda: count() > before, "allowed-settled")
        assert (root / "workspace/proof.txt").read_text() == "approved\n"
        snapshots["file-after-allow"] = (root / "workspace/proof.txt").read_text()
        send("/permissions full")
        wait(lambda: "Enable Full access?" in view(), "full-confirmation")
        keys(b"\x1b", "Escape: cancel Full access")
        wait(lambda: "Enable Full access?" not in view(), "full-cancelled")
        assert "Permissions updated to Full access" not in view(), "Cancellation enabled Full access"
    if not interactive:
        send("/quit")
        wait(lambda: status is not None, "exited")
    assert os.waitstatus_to_exitcode(status) == 0, status
    passed = True
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    os.close(fd)
    try:
        os.kill(pid, 0)
        raise AssertionError("Owned Pi process still exists")
    except ProcessLookupError:
        pass
    (evidence / "terminal.ansi").write_bytes(raw)
    # These are isolated, credential-free fixture files, never user configuration.
    for name in ["agent", "sessions", "workspace"]:
        shutil.copytree(root / name, evidence / name, dirs_exist_ok=True)
    (evidence / "journey.json").write_text(json.dumps({"case": case, "passed": passed if not interactive else None, "completed": passed, "pid": pid, "processStopped": True,
        "command": args, "actions": actions, "screens": snapshots, "events": records()}, ensure_ascii=False, indent=2))
    print(json.dumps({"case": case, "passed": passed, "processStopped": True, "evidence": str(evidence)}))
