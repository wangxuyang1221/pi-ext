#!/usr/bin/env python3
"""Drive production compaction, cancellation, retention and cold continuation offline."""
import codecs
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
import sys
import tempfile
import termios
import time
import pyte

repo = Path(__file__).resolve().parents[4]
evidence = Path(sys.argv[1]).resolve()
assert evidence.is_relative_to(repo / ".tmp"), "Evidence must stay under repository .tmp"
evidence.mkdir(parents=True, exist_ok=False)
root = Path(tempfile.mkdtemp(prefix="compact-pty-", dir=repo / ".tmp"))
for name in ["home", "agent", "workspace", "sessions", "tmp", "cache"]:
    (root / name).mkdir()
env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL"] if key in os.environ}
env.update(HOME=str(root / "home"), TMPDIR=str(root / "tmp"), XDG_CACHE_HOME=str(root / "cache"),
           PI_CODING_AGENT_DIR=str(root / "agent"), PI_TEST_ISOLATED="1", PI_OFFLINE="1",
           PI_SKIP_VERSION_CHECK="1", PI_TELEMETRY="0", TERM="xterm-256color", COMPACT_VERIFY_ROOT=str(root))
(root / "agent/settings.json").write_text(json.dumps({"quietStartup": True, "compaction": {"enabled": False, "keepRecentTokens": 1},
    "cacheWarming": "off", "retry": {"enabled": False}, "doubleEscapeAction": "none"}))
(root / "agent/pi-codex-compact.json").write_text(json.dumps({"manualProjection": {"hiddenTools": []}, "autoCompactTokenLimit": 700000}))
(root / "scenario.json").write_text(json.dumps({"holdCompact": False}))
args = [str(repo / "node_modules/.bin/pi"), "--offline", "--approve", "--no-extensions", "--no-skills", "--no-themes",
    "--no-context-files", "--no-prompt-templates", "--no-builtin-tools", "--session-dir", str(root / "sessions"),
    "--provider", "openai-codex", "--model", "gpt-5.5", "--thinking", "off",
    "-e", str(Path(__file__).with_name("transport.mjs")), "-e", str(repo / "extensions/codex-compact/dist/index.js")]
pid = fd = status = None
children, actions, screens = [], [], {}
raw = bytearray()
passed = False
lock = repo / ".tmp/verify-pi-ext.lock"
owned_lock = False


def events(kind):
    path = root / "events.jsonl"
    return [event for line in path.read_text().splitlines() if (event := json.loads(line))["type"] == kind] if path.exists() else []


def view():
    return "\n".join(line.rstrip() for line in screen.display)


def doctor(label):
    result = subprocess.run(["pnpm", "exec", "node", ".cursor/skills/verify-pi-ext/scripts/verify.mjs", "doctor"], cwd=repo,
                            capture_output=True, text=True, timeout=60)
    (evidence / f"doctor-{label}.json").write_text(result.stdout)
    (evidence / f"doctor-{label}.stderr").write_text(result.stderr)
    assert result.returncode == 0, result.stderr
    if json.loads(result.stdout)["lockPresent"]:
        assert owned_lock and json.loads(lock.read_text())["pid"] == os.getpid(), "Another verification owns the lock"


def start(extra=None):
    global pid, fd, status, screen, stream, decoder
    doctor(f"start-{len(children)}")
    status = None
    screen = pyte.Screen(140, 48)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.chdir(root / "workspace")
            os.execvpe(args[0], args + (extra or []), env)
        except BaseException:
            os._exit(127)
    children.append(pid)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 140, 0, 0))


def pump():
    global status
    if select.select([fd], [], [], 0.05)[0]:
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        raw.extend(data)
        stream.feed(decoder.decode(data))
        if b"\x1b[6n" in data:
            os.write(fd, b"\x1b[1;1R")
    if status is None:
        waited, value = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = value


def wait(predicate, label):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        pump()
        if predicate():
            screens[label] = view()
            return
        if status is not None:
            raise AssertionError(f"Child exited during {label}: {status}\n{view()}")
    raise TimeoutError(f"Timed out: {label}\n{view()}")


def send(text):
    actions.append({"pid": pid, "input": text})
    os.write(fd, text.encode())


def stop():
    global fd
    send("/quit\r")
    wait(lambda: status is not None, "graceful exit")
    assert os.waitstatus_to_exitcode(status) == 0
    os.close(fd)
    fd = None


def checkpoints(path):
    return [item for line in path.read_text().splitlines() if (item := json.loads(line))["type"] == "compaction"]


def interrupted(signum, _frame):
    raise InterruptedError(f"Verification interrupted: {signum}")


signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
try:
    doctor("initial")
    with lock.open("x") as handle:
        handle.write(json.dumps({"pid": os.getpid(), "case": "compact-pty"}))
    owned_lock = True
    start()
    wait(lambda: len(events("ready")) == 1, "initial ready")
    send("/fixture-history\r")
    wait(lambda: len(events("settled")) == 1, "long input and image completed")
    assert len(events("provider-request")) == 1
    original_input = events("provider-request")[0]["data"]["input"]
    assert "BEGIN_RETAIN_" + "x" * 280000 + "_END_RETAIN" in json.dumps(original_input)
    send("/compact\r")
    wait(lambda: len(events("compacted")) == 1 and "Codex compaction applied" in view()
         and "[compaction]" in view() and "Compacted from" in view(), "manual compaction applied")
    session = Path(events("start")[0]["data"]["session"])
    first = checkpoints(session)
    assert len(first) == 1
    retained = first[0]["details"]["replacementHistory"]
    checkpoint = next(item for item in retained if item.get("type") == "compaction")
    assert checkpoint["encrypted_content"].startswith("fixture-checkpoint-")
    assert "x" * 280000 in json.dumps(events("compact-request")[0]["data"])
    assert "x" * 280000 not in json.dumps(retained)
    images = lambda items: [part for item in items for part in item.get("content", []) if isinstance(part, dict) and part.get("type") == "input_image"]
    assert images(original_input) and images(retained) == images(original_input), "Retained image changed"
    assert "PICTURE_LABEL" in json.dumps(retained)
    send("Additional history before cancellation\r")
    wait(lambda: len(events("settled")) == 2, "new history after compaction")
    (root / "scenario.json").write_text(json.dumps({"holdCompact": True}))
    send("/compact\r")
    wait(lambda: len(events("compact-request")) == 2 and "Compacting context..." in view(), "second compaction awaiting service")
    send("\x1b")
    wait(lambda: len(events("compact-cancelled")) == 1, "Escape reached transport cancellation")
    wait(lambda: "Compacting context..." not in view(), "compaction indicator cleared")
    assert checkpoints(session) == first, "Cancellation changed the checkpoint"
    stop()
    assert checkpoints(session) == first, "A late response changed the checkpoint"
    history = session.read_bytes()
    start(["--session", str(session)])
    wait(lambda: len(events("ready")) == 2, "cold session ready")
    assert session.read_bytes() == history, "Opening history changed the session"
    send("Continue after cold restart\r")
    wait(lambda: len(events("settled")) == 3 and "Fixture continuation complete" in view(), "cold continuation completed")
    latest = events("provider-request")[-1]["data"]["input"]
    assert checkpoint in latest, "Cold request lost the checkpoint"
    assert images(latest) == images(original_input), "Cold request lost the retained image"
    assert sum(part.get("text") == "Continue after cold restart" for item in latest for part in item.get("content", []) if isinstance(part, dict)) == 1
    assert len(events("compact-request")) == 2, "Cold continuation unexpectedly compacted again"
    stop()
    passed = True
finally:
    if fd is not None:
        os.close(fd)
    if pid is not None and status is None:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    stopped = []
    for child in children:
        try:
            os.kill(child, 0)
            stopped.append(False)
        except ProcessLookupError:
            stopped.append(True)
    (evidence / "terminal.ansi").write_bytes(raw)
    (evidence / "screens.json").write_text(json.dumps(screens, ensure_ascii=False, indent=2))
    shutil.copytree(root, evidence / "state")
    assert (evidence / "state/agent/settings.json").exists(), "Evidence was not preserved"
    if all(stopped):
        shutil.rmtree(root)
        if owned_lock:
            lock.unlink()
    (evidence / "summary.json").write_text(json.dumps({"passed": passed, "command": args, "pids": children, "stopped": stopped,
        "actions": actions, "scratch": str(root), "cleanup": "removed" if not root.exists() else "unverified"}, indent=2))
    assert all(stopped), "PTY child remains alive"
print(json.dumps({"passed": passed, "evidence": str(evidence)}))
