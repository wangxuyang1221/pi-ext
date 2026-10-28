"""Verify both resume selectors through the real CLI and persisted skill input."""
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

repo = Path(__file__).resolve().parents[3]
root = Path(sys.argv[1]).resolve()
mode = sys.argv[2] if len(sys.argv) > 2 else "native"
installed = Path(sys.argv[4]).resolve() if len(sys.argv) > 4 else repo
root.mkdir(parents=True, exist_ok=False)
for name in ["home", "agent", "workspace", "tmp", "sessions"]:
    (root / name).mkdir()
env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL"] if key in os.environ}
env.update(HOME=str(root / "home"), TMPDIR=str(root / "tmp"), XDG_CACHE_HOME=str(root / "cache"),
           PI_CODING_AGENT_DIR=str(root / "agent"), PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1",
           PI_TELEMETRY="0", PI_TEST_ISOLATED="1", TERM="xterm-256color", SKILL_PTY_ROOT=str(root))
(root / "agent/settings.json").write_text(json.dumps({"quietStartup": True, "compaction": {"enabled": False},
    "cacheWarming": "off", "retry": {"enabled": False}, "doubleEscapeAction": "none"}))
(root / "agent/keybindings.json").write_text(json.dumps({"app.tools.expand": "f3"}))
skill = root / "agent/skills/alpha/SKILL.md"
skill.parent.mkdir(parents=True)
skill.write_text("---\nname: alpha\ndescription: Summary fixture\n---\nSAVED_SKILL_BODY\n")
cli = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else repo / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
args = (["node", str(cli)] if cli.suffix == ".js" else [str(cli)]) + ["--no-extensions", "--extension", str(Path(__file__).with_name("pty-fixture.ts")),
    "--extension", str(installed / "extensions/skill-mentions/dist/index.js"),
    "--no-context-files", "--no-prompt-templates", "--approve", "--offline", "--no-builtin-tools",
    "--session-dir", str(root / "sessions"), "--provider", "faux", "--model", "faux-1",
    "--tui-mode", "fullscreen" if mode.endswith("fullscreen") else "regular"]
if mode.startswith("codex"):
    args += ["--extension", str(installed / "extensions/codex-ui/dist/index.js"), "--theme", str(installed / "themes/codex-pi.json")]
pid = fd = status = None
children, screens, actions = [], {}, []
screen = stream = decoder = None
raw = bytearray()


def events(kind):
    path = root / "events.jsonl"
    if not path.exists():
        return []
    return [event["data"] for line in path.read_text().splitlines() if (event := json.loads(line))["type"] == kind]


def view():
    return "\n".join(line.rstrip() for line in screen.display)


def start(extra=None):
    global pid, fd, status, screen, stream, decoder
    screen = pyte.Screen(140, 48)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    status = None
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(root / "workspace")
        os.execvpe(args[0], args + (extra or []), env)
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
    if status is None:
        waited, value = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = value


def wait(predicate, label):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        pump()
        if predicate():
            return
        if status is not None:
            raise AssertionError(f"Child exited during {label}: {status}\n{view()}")
    raise TimeoutError(f"Timed out: {label}\n{view()}")


def send(text):
    actions.append({"pid": pid, "input": text})
    os.write(fd, text.encode())


def stop():
    send("/quit\r")
    wait(lambda: status is not None, "graceful exit")
    assert os.waitstatus_to_exitcode(status) == 0
    os.close(fd)


task = "中文任务 $alpha"
try:
    start()
    wait(lambda: len(events("ready")) == 1, "initial ready")
    send(task + "\r")
    wait(lambda: len(events("settled")) == 1, "snapshot submitted")
    original = [message for message in events("request")[-1] if message["role"] == "user"][-1]
    assert "SAVED_SKILL_BODY" in json.dumps(original)
    original_session = events("start")[-1]["session"]
    send("/new\r")
    wait(lambda: len(events("ready")) == 2, "new session ready")
    send("Independent session\r")
    wait(lambda: len(events("settled")) == 2, "second session persisted")
    skill.unlink()
    for attempt in range(2):
        send("/resume\r")
        wait(lambda: "Resume Session" in view() and task in view(), "readable in-process selector")
        screens[f"resume-{attempt}"] = view()
        assert "<pi-ext-skill-mentions" not in view()
        send("\x1b")
        wait(lambda: "Resume Session" not in view(), "selector dismissed")
    stop()
    history_before = Path(original_session).read_bytes()

    start(["--resume"])
    wait(lambda: "Resume Session" in view() and task in view(), "readable cold selector before session_start")
    assert len(events("ready")) == 2, "Selection must precede session startup"
    assert "<pi-ext-skill-mentions" not in view()
    screens["cold-resume"] = view()
    send('"中文任务"')
    wait(lambda: task in view() and "Independent session" not in view(), "projected exact search")
    screens["cold-search"] = view()
    send("\r")
    wait(lambda: len(events("ready")) == 3, "selected history restored")
    assert Path(original_session).read_bytes() == history_before, "Selection must not rewrite history"
    send("\x1bOR")
    wait(lambda: "SAVED_SKILL_BODY" in view(), "snapshot card without source skill")
    screens["restored-card"] = view()
    send("Verify restored context\r")
    wait(lambda: len(events("settled")) == 3, "post-resume request")
    assert original in events("request")[-1], "Original user snapshot must reach the model"
    stop()
finally:
    if pid is not None and status is None:
        # Release the PTY before waiting: macOS can block exit while output drains.
        os.close(fd)
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            waited, status_value = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = status_value
                break
            time.sleep(0.02)
        if status is None:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    (root / "terminal.ansi").write_bytes(raw)
    (root / "screens.json").write_text(json.dumps(screens, ensure_ascii=False, indent=2))
    stopped = []
    for child in children:
        try:
            os.kill(child, 0)
            stopped.append(False)
        except ProcessLookupError:
            stopped.append(True)
    (root / "journey.json").write_text(json.dumps({"mode": mode, "cli": str(cli), "pids": children, "stopped": stopped, "actions": actions}, ensure_ascii=False, indent=2))
    assert all(stopped), "All PTY children must be stopped"
print(json.dumps({"mode": mode, "selectors": 3, "modelSnapshotPreserved": True, "childrenStopped": stopped}))
