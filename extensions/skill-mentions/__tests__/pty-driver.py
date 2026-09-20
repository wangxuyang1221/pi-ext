"""Exercise the installed Pi CLI through an OS PTY, without a model service."""
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
import subprocess
import sys
import termios
import time
import pyte

install_root, cli, installed, mode, *extra = sys.argv[1:]
evidence_prefix = extra[0] if extra else "skill-install"
assert evidence_prefix and all(char in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in evidence_prefix)
repo = Path(__file__).resolve().parents[3]
root = Path(install_root) / mode
for name in ["home", "agent", "workspace", "tmp", "sessions"]:
    (root / name).mkdir(parents=True, exist_ok=True)
env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL"] if key in os.environ}
env.update(HOME=str(root / "home"), TMPDIR=str(root / "tmp"), XDG_CACHE_HOME=str(root / "cache"),
           PI_CODING_AGENT_DIR=str(root / "agent"), PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1",
           PI_TELEMETRY="0", PI_HARDWARE_CURSOR="1", TERM="xterm-256color", SKILL_PTY_ROOT=str(root))
settings_file = root / "agent/settings.json"
settings_file.write_text(json.dumps({"quietStartup": True, "compaction": {"enabled": False},
                                     "cacheWarming": "off", "retry": {"enabled": False}, "doubleEscapeAction": "none"}))
# Use the actual local-package install operation before applying supported resource filters.
installation = subprocess.run(["node", cli, "install", installed], cwd=root / "workspace", env=env,
                              capture_output=True, text=True, timeout=30)
assert installation.returncode == 0, installation.stdout + installation.stderr
settings = json.loads(settings_file.read_text())
assert len(settings["packages"]) == 1
assert (settings_file.parent / settings["packages"][0]).resolve() == Path(installed), settings
entries = json.loads((Path(installed) / "package.json").read_text())["pi"]["extensions"]
if mode.startswith("native"):
    selected = [entry for entry in entries if "/skill-mentions/" in entry]
elif mode == "codex":
    selected = [entry for entry in entries if "/codex-ui/" in entry or "/skill-mentions/" in entry]
else:
    selected = entries
if not mode.startswith("combined"):
    settings["packages"] = [{"source": installed, "extensions": [entry.removeprefix("./") for entry in selected]}]
settings_file.write_text(json.dumps(settings))
keys = {"tui.editor.historyPrevious": "ctrl+p", "tui.editor.historyNext": "ctrl+n",
        "tui.editor.cursorLineStart": ["home", "ctrl+a", "f2"], "app.tools.expand": "f3"}
(root / "agent/keybindings.json").write_text(json.dumps(keys))
for name in ["alpha", "beta", "research", "研究_𐐀-𝟠"]:
    skill = root / "agent/skills" / name
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {name.title()} fixture\n---\n{name.upper()}_VERSION_ONE\n")
args = ["node", cli, "--extension", str(Path(install_root) / "consumer/pty-fixture.ts"),
        "--no-context-files", "--no-prompt-templates", "--approve", "--offline", "--no-builtin-tools",
        "--session-dir", str(root / "sessions"), "--provider", "faux", "--model", "faux-1",
        "--tui-mode", "fullscreen" if mode.endswith("fullscreen") else "regular"]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root / "workspace")
    os.execvpe(args[0], args, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 120, 0, 0))
screen = pyte.Screen(120, 50)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")("strict")
status = None
raw = bytearray()
screens = {}
checks = []
reaped = []
events_file = root / "events.jsonl"


def events(kind):
    if not events_file.exists():
        return []
    return [entry["data"] for line in events_file.read_text().splitlines()
            if (entry := json.loads(line))["type"] == kind]


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
            return
        if status is not None:
            break
    raise AssertionError(f"{label}\n{view()}")


def settle(seconds=0.25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()


def send(text):
    os.write(fd, text.encode())
    settle()


def paste(text):
    send("\x1b[200~" + text + "\x1b[201~")


def editor():
    before = len(events("editor"))
    send("\x1b[17~")  # F6, a real extension shortcut reading the public UI API.
    wait(lambda: len(events("editor")) > before, "extension shortcut")
    return events("editor")[-1]["text"]


def text(message):
    content = message["content"]
    return content if isinstance(content, str) else "\n".join(block["text"] for block in content if block["type"] == "text")


def snapshot(message):
    value = text(message)
    if value.startswith('<pi-ext-skill-mentions version="1">\n'):
        return json.loads(value.split("\n")[1])
    return None


def submit(expected_task, names):
    before = len(events("request"))
    settled = len(events("settled"))
    send("\r")
    wait(lambda: len(events("request")) == before + 1 and len(events("settled")) > settled, "submit consumes exactly once")
    users = [message for message in events("request")[-1] if message["role"] == "user"]
    value = snapshot(users[-1])
    if names:
        assert value and value["task"] == expected_task, users[-1]
        assert [skill["name"] for skill in value["skills"]] == names, value
    else:
        assert value is None and text(users[-1]) == expected_task, users[-1]
    assert editor() == ""
    settle()
    assert "pi-ext-skill-mentions version" not in view(), view()
    return value


try:
    wait(lambda: bool(events("ready")), "actual CLI startup")
    settle(1)
    assert events("start")[0]["tty"] is True and events("start")[0]["mode"] == "tui"
    assert "[Extension issues]" not in view(), view()
    editor()
    sources = {item["path"] for item in events("editor")[-1]["commands"] if item["source"] == "extension"}
    if mode.startswith("combined"):
        for name in ["goal", "mcp", "permissions", "codex-ui", "openai-fast-mode"]:
            assert any(f"/{name}/dist/" in path for path in sources), (name, sources)
        assert any("/subagent/dist/" in tool["path"] for tool in events("editor")[-1]["tools"])
    screens["startup"] = view()
    checks.append("installed CLI startup and selected extension commands")

    for query, key, complete in [("$al", "\t", "$alpha"), ("$be", "\r", "$beta")]:
        paste("首行\n用  后文")
        send("\x1b[D" * 3)
        for char in query:
            send(char)
        wait(lambda: "fixture" in view(), "skill candidates")
        screens[f"menu-{query}"] = view()
        before = len(events("request"))
        send(key)
        expected = f"首行\n用 {complete} 后文"
        assert editor() == expected
        assert len(events("request")) == before, "Selection must not send"
        submit(expected, [complete[1:]])
    checks.append("Tab and Enter select without sending; multiline Chinese and suffix preserved")
    screens["native-cards"] = view()
    assert "alpha" in view() and "beta" in view(), view()
    send("\x1bOR")  # F3 custom app.tools.expand binding.
    wait(lambda: "BETA_VERSION_ONE" in view(), "custom expansion shortcut")
    screens["expanded"] = view()
    checks.append("custom app keybinding expands native skill cards")

    send("$alpha")
    send("\x1b")
    assert editor() == "$alpha"
    submit("$alpha", ["alpha"])
    checks.append("Escape keeps an active complete reference")

    paste("光标 $alpha")
    send("\x1b[D" * 2)
    send("x")
    assert "Alpha fixture" not in view()
    send("\x05")
    submit("光标 $alpxha", [])
    checks.append("cursor inside a name does not open candidates")

    for task in ["文字$alpha", "（$alpha）", "$alpha.md $alpha.中文", "`$alpha,`", "```\n$alpha!\n```", "\\$alpha,", "$unknown!", "$12"]:
        paste(task)
        send("\x1b")
        submit(task, [])
    checks.append("period continuations, adjacent text, code, escape, unknown and ordinary dollars remain literal")

    # Run the same final task through typing, paste and both native menu keys.
    punctuated = "用 $alpha，继续 $beta."
    for source in ["handwritten", "paste", "menu-tab", "menu-enter"]:
        if source == "handwritten":
            for char in punctuated:
                send(char)
        elif source == "paste":
            paste(punctuated)
        else:
            send("用 ")
            for query, suffix in [("$al", "，继续 "), ("$be", ".")]:
                for char in query:
                    send(char)
                wait(lambda: "fixture" in view(), "punctuation source candidates")
                before = len(events("request"))
                send("\t" if source == "menu-tab" else "\r")
                assert len(events("request")) == before, "Selection must not send"
                send(suffix)
        assert editor() == punctuated
        submit(punctuated, ["alpha", "beta"])
    checks.append("punctuated typing, paste, Tab and Enter menu completion consume the same unchanged task")

    delimiters = ",.;:!?，。；：！？、…)]}）］｝】》〉」』”’\"'"
    task = " ".join("$research" + delimiter for delimiter in delimiters)
    paste(task)
    submit(task, ["research"])
    paste("$research.md $research.中文 $research.𐐀 $research.𝟠 $research._ $research.- $research-long! $research_other,")
    submit("$research.md $research.中文 $research.𐐀 $research.𝟠 $research._ $research.- $research-long! $research_other,", [])
    paste("用 $研究_𐐀-𝟠，继续 $research.")
    submit("用 $研究_𐐀-𝟠，继续 $research.", ["研究_𐐀-𝟠", "research"])
    checks.append("all allowed delimiters, ASCII period exceptions, whole Unicode names and no prefix truncation")

    paste("用 ,")
    send("\x1b[D")
    for char in "$al":
        send(char)
    assert "Alpha fixture" not in view(), view()
    assert editor() == "用 $al,"
    send("\x05")
    submit("用 $al,", [])
    checks.append("right punctuation never opens a candidate menu")

    paste("手写 $alpha $alpha $beta")
    send("\x1b")
    value = submit("手写 $alpha $alpha $beta", ["alpha", "beta"])
    assert all(str(root / "agent/skills") in skill["location"] for skill in value["skills"])
    checks.append("paste and handwritten complete references; one user, unique ordered snapshots, real paths")

    for _ in range(3):
        before = len(events("ready"))
        paste("/reload")
        send("\r")
        wait(lambda: len(events("ready")) == before + 1, "reload")
        settle(0.5)
        assert "pi-ext-skill-mentions version" not in view()
    send("\x10")  # Custom history binding overrides model cycling.
    assert editor() == "手写 $alpha $alpha $beta"
    screens["history"] = view()
    assert "ALPHA_VERSION_ONE" in view() and "BETA_VERSION_ONE" in view(), view()
    send("\x03")
    assert editor() == ""
    # User keybindings are reloaded from disk, not captured by the wrapper.
    keys["tui.editor.cursorLineStart"] = ["home", "ctrl+a", "f4"]
    (root / "agent/keybindings.json").write_text(json.dumps(keys))
    before = len(events("ready"))
    paste("/reload")
    send("\r")
    wait(lambda: len(events("ready")) > before, "reload keybindings")
    settle(0.5)
    paste("中文")
    send("\x1bOS")  # F4
    send("前")
    assert editor() == "前中文"
    send("\x03")
    checks.append("four real reloads preserve snapshots and custom history; changed keybindings take effect")

    before = len(events("request"))
    settled = len(events("settled"))
    paste("/fixture-user")
    send("\r")
    wait(lambda: len(events("request")) == before + 1 and len(events("settled")) > settled, "extension user")
    last = [message for message in events("request")[-1] if message["role"] == "user"][-1]
    assert [skill["name"] for skill in snapshot(last)["skills"]] == ["alpha", "beta"]
    assert len([block for block in last["content"] if block["type"] == "image"]) == 1
    checks.append("another extension sends one ordinary user with deduplicated skills and image")

    (root / "agent/skills/beta/SKILL.md").unlink()
    paste("缺失 $beta, $alpha! $unknown.")
    submit("缺失 $beta, $alpha! $unknown.", ["alpha"])
    assert "Failed to read" not in view() and "ENOENT" not in view()
    checks.append("unreadable discovered skill and unknown name fall back silently beside a valid skill")

    for char in "/skill:al":
        send(char)
    wait(lambda: "Alpha fixture" in view(), "native slash candidates")
    send("\t")
    assert editor().strip() == "/skill:alpha"
    before = len(events("request"))
    settled = len(events("settled"))
    send("\r")
    wait(lambda: len(events("request")) == before + 1 and len(events("settled")) > settled, "native slash invocation")
    last = [message for message in events("request")[-1] if message["role"] == "user"][-1]
    assert snapshot(last) is None and '<skill name="alpha"' in text(last), text(last)
    checks.append("native slash autocomplete and invocation unchanged")

    before = len(events("request"))
    settled = len(events("settled"))
    paste("QUEUE_HOLD")
    send("\r")
    wait(lambda: len(events("request")) == before + 1, "hold provider")
    paste("排队 $alpha，继续")
    send("\x1b\r")  # Native Alt+Enter queues a follow-up.
    settle()
    screens["queue"] = view()
    assert "排队 $alpha，继续" in view(), view()
    skill = root / "agent/skills/alpha/SKILL.md"
    skill.write_text("---\nname: alpha\ndescription: Alpha fixture\n---\nALPHA_VERSION_TWO\n")
    wait(lambda: len(events("request")) == before + 2 and len(events("settled")) > settled, "queue consumption", 15)
    last = [message for message in events("request")[-1] if message["role"] == "user"][-1]
    assert snapshot(last)["task"] == "排队 $alpha，继续"
    assert "ALPHA_VERSION_TWO" in snapshot(last)["skills"][0]["body"]
    checks.append("real TUI follow-up queue keeps original text and consumes changed file version")

    starts = events("start")
    session = Path(starts[-1]["session"])
    disk = [json.loads(line) for line in session.read_text().splitlines()]
    disk_users = [entry["message"] for entry in disk if entry.get("type") == "message" and entry["message"]["role"] == "user"]
    model_users = [message for message in events("request")[-1] if message["role"] == "user"]
    assert disk_users == model_users, "Disk users must equal actual provider request users"
    assert len({snapshot(user)["requestId"] for user in disk_users if snapshot(user)}) == len([user for user in disk_users if snapshot(user)])
    checks.append("actual CLI JSONL users, snapshots and unique association IDs")
    paste("/quit")
    send("\r")
    wait(lambda: status is not None, "graceful exit")
    assert os.waitstatus_to_exitcode(status) == 0
    checks.append("graceful exit")
    reaped.append(pid)
    os.close(fd)

    # Restart the actual CLI on the persisted file after deleting the remaining source.
    skill.unlink()
    ready_count = len(events("ready"))
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(root / "workspace")
        os.execvpe(args[0], args + ["--session", str(session)], env)
    status = None
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 120, 0, 0))
    screen = pyte.Screen(120, 50)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder("utf-8")("strict")
    wait(lambda: len(events("ready")) > ready_count, "resume real CLI")
    settle(1)
    send("\x10")
    assert editor() == "排队 $alpha，继续"
    assert "pi-ext-skill-mentions version" not in view()
    screens["resume"] = view()
    send("\x03")
    send("\x1bOR")
    wait(lambda: "ALPHA_VERSION_TWO" in view(), "resume snapshot without source")
    paste("恢复后继续")
    submit("恢复后继续", [])
    resumed_users = [message for message in events("request")[-1] if message["role"] == "user"]
    assert resumed_users[:-1] == disk_users
    checks.append("real CLI restart/resume restores original history and model snapshots after source deletion")
    paste("/quit")
    send("\r")
    wait(lambda: status is not None, "resume graceful exit")
    assert os.waitstatus_to_exitcode(status) == 0
    print(json.dumps({"mode": mode, "passed": True, "checks": len(checks), "requests": len(events("request")), "pids": reaped + [pid]}))
finally:
    if status is None:
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 5
        while status is None and time.monotonic() < deadline:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            _, status = os.waitpid(pid, 0)
    os.close(fd)
    reaped.append(pid)
    for child in reaped:
        assert subprocess.run(["kill", "-0", str(child)], capture_output=True).returncode != 0
    result = {"mode": mode, "pids": reaped, "exit": os.waitstatus_to_exitcode(status), "checks": checks,
              "selectedExtensions": selected, "screens": screens, "lastScreen": view(),
              "installation": installation.stdout, "requests": len(events("request")),
              "diskUsers": disk_users if "disk_users" in globals() else [],
              "starts": events("start"), "shutdowns": events("shutdown"),
              "editorObservations": events("editor"), "inputs": events("input"),
              "providerUsers": [[message for message in request if message["role"] == "user"][-1:] for request in events("request")],
              "cleanup": "PTY child reaped; no listener created; parent removes isolated installation"}
    (repo / f"adventure/evidence/{evidence_prefix}-pty-{mode}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
