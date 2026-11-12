"""Verify both resume selectors through the real CLI and persisted skill input."""
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
import sys
import termios
import time
import pyte

repo = Path(__file__).resolve().parents[3]
root = Path(sys.argv[1]).resolve()
mode = sys.argv[2] if len(sys.argv) > 2 else "native"
installed = Path(sys.argv[4]).resolve() if len(sys.argv) > 4 else repo
stock_summary = "--stock-summary" in sys.argv
assert mode in ["native", "native-fullscreen", "codex", "codex-fullscreen"]
assert root.is_relative_to(repo / ".tmp"), "Evidence must stay inside the repository .tmp"
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
children, screens, actions, assertions = [], {}, [], []
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


def settle(seconds=0.5):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()


def send(text):
    actions.append({"pid": pid, "input": text, "time": time.monotonic()})
    os.write(fd, text.encode())


def stop():
    send("/quit\r")
    wait(lambda: status is not None, "graceful exit")
    assert os.waitstatus_to_exitcode(status) == 0
    os.close(fd)


task = "中文任务 $alpha"
selector_text = "<pi-ext-skill-mentions" if stock_summary else task
def terminate(signum, frame):
    raise SystemExit(128 + signum)


signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)


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
    actions.append({"kind": "file-delete", "path": str(skill)})
    for attempt in range(2):
        send("/resume\r")
        wait(lambda: "Resume Session" in view() and selector_text in view(), "readable in-process selector")
        screens[f"resume-{attempt}"] = view()
        assert ("<pi-ext-skill-mentions" in view().split("Resume Session", 1)[-1]) == stock_summary
        if stock_summary:
            send("SAVED_SKILL_BODY")
            wait(lambda: selector_text in view().split("Resume Session", 1)[-1] and "Independent session" not in view().split("Resume Session", 1)[-1], "stock body search retains snapshot")
            screens[f"stock-body-search-{attempt}"] = view()
            send("\x15")
        if not stock_summary:
            send("SAVED_SKILL_BODY")
            wait(lambda: "No sessions" in view(), "hidden snapshot body excluded from hot search")
            screens[f"hidden-body-search-{attempt}"] = view()
            send("\x15")
        send('"中文任务"')
        wait(lambda: selector_text in view().split("Resume Session", 1)[-1] and "Independent session" not in view().split("Resume Session", 1)[-1], "in-process exact search")
        screens[f"in-process-search-{attempt}"] = view()
        history_before = Path(original_session).read_bytes()
        ready_count = len(events("ready"))
        send("\r")
        wait(lambda: len(events("ready")) == ready_count + 1, "in-process selected history")
        settle()
        assert events("start")[-1]["session"] == original_session, "Selected session identity must match the original session"
        assert Path(original_session).read_bytes() == history_before, "Selection must not rewrite history"
        # A selection restores collapsed cards. Toggle only if the saved body is hidden.
        if "SAVED_SKILL_BODY" not in view():
            send("\x1bOR")
        wait(lambda: "SAVED_SKILL_BODY" in view(), "in-process restored card without source")
        screens[f"in-process-card-{attempt}"] = view()
        settled_count = len(events("settled"))
        send(f"Verify in-process context {attempt}\r")
        wait(lambda: len(events("settled")) == settled_count + 1, "in-process continued request")
        assert original in events("request")[-1], "In-process original snapshot must reach model"
        assertions.append({"selector": "in-process", "attempt": attempt, "session": original_session, "modelSnapshotPreserved": True, "historyUnchangedOnSelection": True})
        if attempt == 0:
            send("/new\r")
            wait(lambda: len(events("ready")) == ready_count + 2, "new session between selectors")
            send("Independent session again\r")
            wait(lambda: len(events("settled")) == settled_count + 2, "second independent session persisted")
    stop()
    history_before = Path(original_session).read_bytes()

    ready_count = len(events("ready"))
    settled_count = len(events("settled"))
    start_count, request_count = len(events("start")), len(events("request"))
    start(["--resume"])
    wait(lambda: "Resume Session" in view() and selector_text in view(), "cold selector before session_start")
    assert len(events("ready")) == ready_count, "Selection must precede session startup"
    assert len(events("start")) == start_count and len(events("request")) == request_count
    assert ("<pi-ext-skill-mentions" in view()) == stock_summary
    screens["cold-resume"] = view()
    if not stock_summary:
        send("SAVED_SKILL_BODY")
        wait(lambda: "No sessions" in view(), "hidden snapshot body excluded from cold search")
        screens["cold-hidden-body-search"] = view()
        send("\x15")
    send('"中文任务"')
    wait(lambda: selector_text in view() and "Independent session" not in view(), "projected exact search")
    screens["cold-search"] = view()
    send("\r")
    wait(lambda: len(events("ready")) == ready_count + 1, "selected history restored")
    settle()
    assert events("start")[-1]["session"] == original_session, "Cold selection must restore original session identity"
    assert Path(original_session).read_bytes() == history_before, "Selection must not rewrite history"
    send("\x1bOR")
    wait(lambda: "SAVED_SKILL_BODY" in view(), "snapshot card without source skill")
    screens["restored-card"] = view()
    send("Verify restored context\r")
    wait(lambda: len(events("settled")) == settled_count + 1, "post-resume request")
    assert original in events("request")[-1], "Original user snapshot must reach the model"
    assertions.append({"selector": "cold", "session": original_session, "modelSnapshotPreserved": True, "historyUnchangedOnSelection": True})
    stop()

    if "--cwd-cases" in sys.argv:
        from hashlib import sha256
        source_bytes = Path(original_session).read_bytes()
        project = root / "workspace/.pi/extensions"
        project.mkdir(parents=True)
        marker = root / "untrusted-loaded"
        (project / "untrusted.ts").write_text('import { writeFileSync } from "node:fs"; writeFileSync(' + json.dumps(str(marker)) + ', "loaded"); export default function() {}')
        saved_args = args[:]
        args = [value for value in args if value not in ["--approve", "--no-extensions"]]
        args += ["--no-approve"]
        ready_count = len(events("ready"))
        start_count, request_count = len(events("start")), len(events("request"))
        start(["--resume"])
        wait(lambda: "Resume Session" in view() and selector_text in view(), "untrusted startup selector")
        assert len(events("ready")) == ready_count and not marker.exists()
        assert len(events("start")) == start_count and len(events("request")) == request_count
        screens["untrusted-startup"] = view()
        send("\x1b")
        wait(lambda: status is not None, "cancel startup selector")
        assert os.waitstatus_to_exitcode(status) == 0
        os.close(fd)
        assert len(events("ready")) == ready_count and not marker.exists()
        assertions.append({"selector": "cold-trust", "untrustedExtensionNotLoaded": True, "noSessionLifecycleBeforeSelection": True})
        args = saved_args
        missing = root / "sessions/missing-cwd.jsonl"
        rows = [json.loads(line) for line in source_bytes.decode().splitlines()]
        rows[0]["cwd"] = str(root / "does-not-exist")
        rows[0]["id"] = "15215215-2152-4152-8152-152152152152"
        rows.append({"type": "session_info", "id": "152label", "parentId": rows[-1]["id"], "timestamp": "2026-11-12T00:00:00.000Z", "name": "CWD152"})
        missing.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
        missing_bytes = missing.read_bytes()
        for branch in ["cancel", "continue", "fork"]:
            ready_count = len(events("ready"))
            start(["--resume"])
            wait(lambda: "Resume Session" in view(), "missing cwd cold resume selector")
            send("\t")
            send("CWD152")
            wait(lambda: any(line.lstrip().startswith("› CWD152") for line in screen.display), "all-project selector finds selected missing cwd row")
            settle()
            send("\r")
            wait(lambda: "Continue" in view() and "Fork" in view(), "missing cwd options retained")
            screens[f"missing-cwd-{branch}"] = view()
            if branch == "cancel":
                send("\x1b")
                wait(lambda: status is not None, "missing cwd cancel exits")
                assert os.waitstatus_to_exitcode(status) == 0
                os.close(fd)
                assert len(events("ready")) == ready_count
            else:
                if branch == "fork":
                    send("\x1b[B")
                send("\r")
                wait(lambda: len(events("ready")) == ready_count + 1, "missing cwd selected runtime ready")
                assert events("start")[-1]["cwd"] == str(root / "workspace")
                selected = events("start")[-1]["session"]
                if branch == "continue":
                    assert selected == str(missing)
                else:
                    assert selected != str(missing)
                    fork_rows = [json.loads(line) for line in Path(selected).read_text().splitlines()]
                    assert fork_rows[0]["cwd"] == str(root / "workspace")
                    assert any(row.get("type") == "message" for row in fork_rows)
                stop()
            assert missing.read_bytes() == missing_bytes
            assert Path(original_session).read_bytes() == source_bytes
            assertions.append({"selector": "missing-cwd", "branch": branch, "originalSha256": sha256(source_bytes).hexdigest(), "missingSha256": sha256(missing_bytes).hexdigest(), "historyUnchanged": True})
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
    assert all(stopped), "All PTY children must be stopped"
    for name in ["home", "tmp", "cache", "workspace"]:
        shutil.rmtree(root / name, ignore_errors=True)
    (root / "journey.json").write_text(json.dumps({"mode": mode, "stockSummary": stock_summary, "cli": str(cli), "pids": children, "stopped": stopped, "actions": actions, "assertions": assertions, "runtimeDirectoriesRemoved": True}, ensure_ascii=False, indent=2))
print(json.dumps({"mode": mode, "selectors": 3, "modelSnapshotPreserved": True, "childrenStopped": stopped}))
