#!/usr/bin/env python3
"""Drive production compaction, cancellation, retention and cold continuation offline."""
import codecs
import errno
import fcntl
import hashlib
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
case = sys.argv[2] if len(sys.argv) > 2 else "combination"
assert case in {"combination", "automatic", "threshold", "overflow", "repeated-overflow", "navigation", "model-boundaries", "model-boundaries-tools", "stale", "stale-session", "stale-tree", "stale-tools", "legacy-provable", "legacy-truncated", "usage-invalid", "usage-failed", "usage-source"}, "Unknown case"
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
(root / "agent/settings.json").write_text(json.dumps({"quietStartup": True, "compaction": {"enabled": False, "keepRecentTokens": 1, "reserveTokens": 100000},
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
failure = None
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
    actions.append({"pid": pid, "start": args + (extra or [])})
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


def scenario(**updates):
    path = root / "scenario.json"
    value = json.loads(path.read_text())
    value.update(updates)
    path.write_text(json.dumps(value))
    actions.append({"seed": "scenario", "updates": updates})


def configure(**updates):
    path = root / "agent/pi-codex-compact.json"
    value = json.loads(path.read_text())
    value.update(updates)
    path.write_text(json.dumps(value))
    actions.append({"seed": "config", "updates": updates})


def entries(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def interrupted(signum, _frame):
    raise InterruptedError(f"Verification interrupted: {signum}")


signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
try:
    doctor("initial")
    with lock.open("x") as handle:
        handle.write(json.dumps({"pid": os.getpid(), "case": "compact-pty"}))
    owned_lock = True
    if case == "combination":
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
        config = root / "agent/pi-codex-compact.json"
        before_config = json.loads(config.read_text())
        send("/codex-metadata version 0.157.0\r")
        wait(lambda: json.loads(config.read_text()).get("metadataClientVersion") == "0.157.0" and "Saved metadata" in view(), "metadata changed after cancellation")
        send("/codex-metadata reset\r")
        wait(lambda: json.loads(config.read_text()) == before_config and "Reset global metadata" in view(), "reset preserved compaction settings")
        scenario(holdCompact=False)
        send("/compact\r")
        wait(lambda: len(events("compacted")) == 2 and "Codex compaction applied" in view(), "retry after cancellation applied")
        second = checkpoints(session)
        assert len(second) == 2 and second[0] == first[0], "Retry corrupted the previous checkpoint"
        checkpoint = next(item for item in second[-1]["details"]["replacementHistory"] if item.get("type") == "compaction")
        assert checkpoint not in first[0]["details"]["replacementHistory"], "Retry reused the old checkpoint"
        first = second
        send("/name Compact verification target\r")
        wait(lambda: "Compact verification target" in session.read_text(), "named saved session")
        send("/new\r")
        wait(lambda: len(events("start")) == 2, "new session in same process")
        send("/resume\r")
        wait(lambda: "Compact verification target" in view() and "Resume Session" in view(), "resume selector opened")
        send("Compact verification target")
        wait(lambda: "Compact verification target" in view(), "resume selector filtered")
        send("\r")
        wait(lambda: len(events("start")) == 3 and "Resumed session" in view(), "resume selector selected saved session")
        assert events("start")[-1]["data"]["session"] == str(session), "Resume selected another session"
        scenario(callTool=True)
        send("Continue using fixture_read after selector resume\r")
        wait(lambda: len(events("tool-read")) == 1 and len(events("settled")) == 3, "tool executes after selector resume")
        tool_request = events("provider-request")[-1]["data"]
        assert checkpoint in tool_request["input"], "Tool continuation lost checkpoint"
        assert "FIXTURE_TOOL_RESULT" in json.dumps(tool_request), "Tool result missing from actual request"
        first_tool_request = events("provider-request")[-2]["data"]
        declarations = first_tool_request.get("tools", []) + [tool for item in first_tool_request["input"]
                        if item.get("type") == "additional_tools" for tool in item.get("tools", [])]
        assert any(tool.get("name") == "fixture_read" for tool in declarations), "Restored tool declaration missing"
        assert any(item.get("type") == "additional_tools" and any(tool["name"] == "fixture_late" for tool in item["tools"]) for item in tool_request["input"]), "Mid-conversation tool update missing"
        scenario(systemPrompt="UPDATED_SYSTEM_PROMPT")
        send("Continue after system update\r")
        wait(lambda: len(events("settled")) == 4, "system prompt update completed")
        assert "UPDATED_SYSTEM_PROMPT" in json.dumps(events("provider-request")[-1]["data"]), "Updated system prompt absent"
        assert checkpoint in events("provider-request")[-1]["data"]["input"], "System update lost checkpoint"
        stop()
        assert checkpoints(session) == first, "A late response changed the checkpoint"
        history = session.read_bytes()
        start(["--session", str(session)])
        wait(lambda: len(events("ready")) == 4, "cold session ready")
        assert session.read_bytes() == history, "Opening history changed the session"
        send("Continue after cold restart\r")
        wait(lambda: len(events("settled")) == 5 and "Fixture continuation complete" in view(), "cold continuation completed")
        latest = events("provider-request")[-1]["data"]["input"]
        assert checkpoint in latest, "Cold request lost the checkpoint"
        assert images(latest) == images(original_input), "Cold request lost the retained image"
        assert sum(part.get("text") == "Continue after cold restart" for item in latest for part in item.get("content", []) if isinstance(part, dict)) == 1
        assert len(events("compact-request")) == 3, "Cold continuation unexpectedly compacted again"
        stop()
    elif case in {"threshold", "overflow", "repeated-overflow"}:
        settings = json.loads((root / "agent/settings.json").read_text())
        settings["compaction"]["enabled"] = True
        (root / "agent/settings.json").write_text(json.dumps(settings))
        if case == "threshold":
            scenario(usage=710000)
        else:
            scenario(overflow="repeat" if case == "repeated-overflow" else True)
        start()
        wait(lambda: len(events("ready")) == 1, "host automatic ready")
        send("/fixture-history\r")
        wait(lambda: len(events("compacted")) == 1 and "[compaction]" in view()
             and ("Codex compaction applied" in view() or case == "repeated-overflow" and "after one" in view()),
             "host automatic compact applied")
        session = Path(events("start")[0]["data"]["session"])
        assert events("compacted")[0]["data"]["reason"] == ("threshold" if case == "threshold" else "overflow")
        assert len(checkpoints(session)) == 1
        if case != "threshold":
            wait(lambda: len(events("settled")) == 1, "overflow retry settled")
            assert len(events("provider-request")) == 2, "Overflow retry count changed"
            assert "x" * 280000 not in json.dumps(events("compact-request")[0]["data"]["input"]), "Pending input leaked into compact body"
            latest = events("provider-request")[-1]["data"]["input"]
            assert json.dumps(latest).count("BEGIN_RETAIN_" + "x" * 280000 + "_END_RETAIN") == 1, "Pending input was lost or duplicated"
            if case == "repeated-overflow":
                wait(lambda: "after one" in view(), "repeated overflow stops after one retry")
        else:
            scenario(usage=20)
            send("Continue after threshold\r")
            wait(lambda: len(events("settled")) == 2, "threshold continuation")
            assert any(item.get("type") == "compaction" for item in events("provider-request")[-1]["data"]["input"])
        stop()
    elif case == "automatic":
        scenario(usage=710000)
        start()
        wait(lambda: len(events("ready")) == 1, "pre-request ready")
        send("/fixture-history\r")
        wait(lambda: len(events("settled")) == 1, "initial history settled")
        send("/compact\r")
        wait(lambda: len(events("compacted")) == 1, "seed checkpoint for automatic compaction")
        send("Tail after checkpoint\r")
        wait(lambda: len(events("settled")) == 2, "tail after checkpoint settled")
        configure(autoCompactTokenLimit=1000)
        scenario(holdCompact=True)
        send("PENDING_AUTOMATIC_INPUT\r")
        wait(lambda: len(events("compact-request")) == 2 and "Compacting context... (esc to cancel)" in view(), "pre-request animation")
        frame = next(line.strip()[0] for line in view().splitlines() if "Compacting context... (esc to cancel)" in line)
        wait(lambda: any(line.strip()[0] != frame for line in view().splitlines()
                         if "Compacting context... (esc to cancel)" in line), "pre-request animated frame")
        session = Path(events("start")[0]["data"]["session"])
        first = checkpoints(session)
        assert len(first) == 1
        send("\x1b")
        wait(lambda: len(events("compact-cancelled")) == 1 and "Compacting context..." not in view(), "automatic Escape clears animation")
        assert checkpoints(session) == first, "Automatic cancel committed a checkpoint"
        wait(lambda: len(events("settled")) == 3, "cancelled request settled")
        assert len(events("provider-request")) == 2, "Cancelled input reached provider"
        scenario(holdCompact=False)
        send("Retry automatic compaction\r")
        wait(lambda: len(events("settled")) == 4 and "Codex context compacted (automatic)" in view(), "automatic retry succeeds")
        assert any(item.get("type") == "custom" and item.get("customType") == "openai-codex-native-compaction" for item in entries(session)), "Automatic checkpoint missing"
        assert "PENDING_AUTOMATIC_INPUT" in json.dumps(events("provider-request")[-1]["data"]), "Cancelled pending input lost on retry"
        configure(autoCompactTokenLimit=700000)
        send("History before service failure\r")
        wait(lambda: len(events("settled")) == 5, "history before failure")
        checkpoint_before = [item for item in entries(session) if item.get("type") in {"compaction", "custom"}]
        scenario(compactFailure=True)
        send("/compact\r")
        wait(lambda: "code=invalid_api_key" in view() and "outcome=compaction_cancelled" in view(), "service failure notice")
        assert [item for item in entries(session) if item.get("type") in {"compaction", "custom"}] == checkpoint_before, "Failure changed the checkpoint"
        scenario(compactFailure=False)
        send("Continue after service failure\r")
        wait(lambda: len(events("settled")) == 6, "failure continuation")
        stop()
    elif case == "navigation":
        start()
        wait(lambda: len(events("ready")) == 1, "navigation ready")
        send("BRANCH_ROOT_CONTENT\r")
        wait(lambda: len(events("settled")) == 1, "root response")
        send("/compact\r")
        wait(lambda: len(events("compacted")) == 1, "navigation checkpoint")
        session = Path(events("start")[0]["data"]["session"])
        original = next(item for item in checkpoints(session)[-1]["details"]["replacementHistory"] if item.get("type") == "compaction")
        for model in ["fixture-same", "fixture-other", "fixture-small", "fixture-noncodex"]:
            previous = len(events("model-select"))
            send("/model\r")
            wait(lambda: "Only showing models from configured providers" in view(), f"model selector {model}")
            send(model)
            wait(lambda: model in view(), f"model selector filtered {model}")
            send("\r")
            wait(lambda: len(events("model-select")) > previous and events("model-select")[-1]["data"]["model"] == model, f"model selected {model}")
            previous = len(events("settled"))
            send(f"Continue on {model}\r")
            wait(lambda: len(events("settled")) > previous, f"model continuation {model}")
            latest = events("provider-request")[-1]["data"]["input"]
            if model == "fixture-same":
                assert original in latest, "Same-hash switch lost checkpoint"
            elif model == "fixture-noncodex":
                assert "BRANCH_ROOT_CONTENT" in json.dumps(latest), "Non-Codex switch lost original branch"
                assert not any(item.get("type") == "compaction" for item in latest), "Non-Codex replay contains opaque checkpoint"
            else:
                assert any(item.get("type") == "compaction" for item in latest), "Converted checkpoint missing"
        send("/tree\r")
        wait(lambda: "BRANCH_ROOT_CONTENT" in view() and "filter" in view().lower(), "tree selector opened")
        send("branch_root_content")
        wait(lambda: "Type to search: branch_root_content" in view(), "tree selector filtered")
        send("\r")
        wait(lambda: "Summarize branch?" in view(), "branch summary choice")
        send("\r")
        wait(lambda: len(events("tree")) == 1, "tree selection applied")
        previous = len(events("settled"))
        send("BRANCH_AFTER_NAVIGATION\r")
        wait(lambda: len(events("settled")) > previous, "branched continuation")
        latest = events("provider-request")[-1]["data"]["input"]
        assert "BRANCH_AFTER_NAVIGATION" in json.dumps(latest)
        assert "Continue on fixture-noncodex" not in json.dumps(latest), "Tree selected old descendant"
        stop()
    elif case.startswith("model-boundaries"):
        scenario(emptyTools=case == "model-boundaries")
        start()
        wait(lambda: len(events("ready")) == 1, "model boundaries ready")
        send("/fixture-history\r")
        wait(lambda: len(events("settled")) == 1, "large model history settled")
        send("/compact\r")
        wait(lambda: len(events("compacted")) == 1, "large model checkpoint committed")
        session = Path(events("start")[0]["data"]["session"])
        original = checkpoints(session)
        old_checkpoint = next(item for item in original[-1]["details"]["replacementHistory"] if item.get("type") == "compaction")
        send("/model\r")
        wait(lambda: "Only showing models from configured providers" in view(), "tight model selector opened")
        send("fixture-tight")
        wait(lambda: "fixture-tight" in view(), "tight model selector filtered")
        send("\r")
        wait(lambda: bool(events("model-select")) and events("model-select")[-1]["data"]["model"] == "fixture-tight", "tight model selected")
        send("Continue within the smaller window\r")
        wait(lambda: len(events("settled")) == 2 and "Codex context compacted (model transition)." in view(), "tight model compaction completed")
        assert len(events("compact-request")) == 2, "Downshift did not create exactly one additional checkpoint"
        assert events("tight-preparation-budget")[0]["data"]["tokens"] > 11400, "Tight model seed did not exceed the effective window"
        assert events("tight-request-budget")[-1]["data"]["tokens"] <= 11400, "Converted request exceeds the effective window"
        tight_input = events("provider-request")[-1]["data"]["input"]
        assert json.dumps(tight_input).count("Continue within the smaller window") == 1, "Downshift lost or duplicated pending input"
        if case == "model-boundaries-tools":
            declarations = [tool for item in tight_input if item.get("type") == "additional_tools" for tool in item.get("tools", [])]
            assert any(tool.get("name") == "fixture_read" for tool in declarations), "Downshift dropped the restored tool declaration"
        new_checkpoint = next(item for item in tight_input if item.get("type") == "compaction")
        assert new_checkpoint != old_checkpoint, "Downshift reused the old oversized checkpoint history"
        assert checkpoints(session) == original, "Downshift rewrote the original host checkpoint"
        native_before = [item for item in entries(session) if item.get("customType") == "openai-codex-native-compaction"]
        assert native_before[-1]["data"]["modelKey"].endswith(":fixture-tight"), "Downshift checkpoint was not rebound to the selected model"
        send("/model\r")
        wait(lambda: "Only showing models from configured providers" in view(), "mismatch model selector opened")
        send("fixture-other")
        wait(lambda: "fixture-other" in view(), "mismatch model selector filtered")
        send("\r")
        wait(lambda: events("model-select")[-1]["data"]["model"] == "fixture-other", "mismatch model selected")
        provider_count = len(events("provider-request"))
        compact_count = len(events("compact-request"))
        scenario(prefixMismatch=True)
        send("Input after incompatible projection\r")
        wait(lambda: len(events("settled")) == 3 and "code=history_prefix_mismatch" in view()
             and "outcome=request_aborted" in view(), "mismatched prefix rejected")
        assert len(events("prefix-mismatch-injected")) == 1
        assert len(events("provider-request")) == provider_count, "Mismatched history reached the provider"
        assert len(events("compact-request")) == compact_count, "Mismatched history reached remote compaction"
        assert checkpoints(session) == original, "Prefix rejection changed the host checkpoint"
        assert [item for item in entries(session) if item.get("customType") == "openai-codex-native-compaction"] == native_before, "Prefix rejection changed the native checkpoint"
        scenario(prefixMismatch=False)
        send("Continue after fixing the projection\r")
        wait(lambda: len(events("settled")) == 4 and "Fixture continuation complete" in view(), "valid projection recovered")
        assert events("provider-request")[-1]["data"]["model"] == "fixture-other"
        assert len(events("provider-request")) == provider_count + 1
        stop()
    elif case.startswith("stale"):
        start()
        wait(lambda: len(events("ready")) == 1, "stale ready")
        send("History before stale response\r")
        wait(lambda: len(events("settled")) == 1, "stale history settled")
        send("/compact\r")
        wait(lambda: len(events("compacted")) == 1, "stale original checkpoint")
        session = Path(events("start")[0]["data"]["session"])
        before = [item for item in entries(session) if item.get("type") in {"compaction", "custom"}]
        original_checkpoints = checkpoints(session)
        original_native = [item for item in entries(session) if item.get("customType") == "openai-codex-native-compaction"]
        send("/model fixture-other\r")
        wait(lambda: any(event["data"]["model"] == "fixture-other" for event in events("model-select")), "stale transition selected")
        scenario(holdCompact=True)
        send("Pending during model transition\r")
        wait(lambda: len(events("compact-request")) == 2 and "Compacting context..." in view(), "transition waiting")
        if case == "stale":
            send("/model\r")
            wait(lambda: "Only showing models from configured providers" in view(), "model selector while pending")
            send("gpt-5.5")
            wait(lambda: "gpt-5.5" in view(), "stale model filtered")
            send("\r")
            wait(lambda: len(events("compact-cancelled")) == 1 and events("model-select")[-1]["data"]["model"] == "gpt-5.5", "model change aborted old transport")
            wait(lambda: "Compacting context..." not in view(), "stale widget cleared")
            assert [item for item in entries(session) if item.get("type") in {"compaction", "custom"}] == before, "Stale response changed checkpoint"
        elif case == "stale-session":
            send("/new\r")
            wait(lambda: len(events("start")) == 2 and len(events("compact-cancelled")) == 1, "session switch aborted old response")
        elif case == "stale-tree":
            send("/tree\r")
            wait(lambda: "Type to search:" in view(), "tree selector while pending")
            send("history before stale response")
            wait(lambda: "Type to search: history before stale response" in view(), "pending tree filtered")
            send("\r")
            wait(lambda: "Summarize branch?" in view(), "pending tree summary choice")
            send("\r")
            wait(lambda: len(events("tree")) == 1 and len(events("compact-cancelled")) == 1, "tree selection aborted old response")
        else:
            send("/fixture-change-tools\r")
            wait(lambda: len(events("tools-changed")) == 1, "declarations changed while pending")
            scenario(holdCompact=False)
            wait(lambda: len(events("compact-released")) == 1 and len(events("settled")) == 2, "late response with changed tools rejected")
        wait(lambda: "Compacting context..." not in view(), "stale widget cleared")
        assert checkpoints(session) == original_checkpoints, "Stale response changed checkpoint"
        assert [item for item in entries(session) if item.get("customType") == "openai-codex-native-compaction"] == original_native, "Stale response appended a native checkpoint"
        scenario(holdCompact=False)
        previous = len(events("settled"))
        send("Continue after stale transition\r")
        wait(lambda: len(events("settled")) > previous, "stale continuation")
        assert len(events("compacted")) == 1, "Old transition committed late"
        stop()
    elif case.startswith("usage-"):
        start()
        wait(lambda: len(events("ready")) == 1, "usage ready")
        send("/fixture-history\r")
        wait(lambda: len(events("settled")) == 1, "usage long history")
        assert not events("compact-request"), "Initial pending input unexpectedly compacted"
        configure(autoCompactTokenLimit=10000)
        send("Low successful usage should retain baseline\r")
        wait(lambda: len(events("settled")) == 2, "valid usage baseline")
        assert not events("compact-request"), "Valid small usage baseline ignored"
        if case == "usage-invalid":
            scenario(usage=0)
        elif case == "usage-failed":
            scenario(normalFailure=True)
        else:
            scenario(systemPrompt="USAGE_SOURCE_CHANGED")
        if case != "usage-source":
            send("Invalidate the usage baseline\r")
            wait(lambda: len(events("settled")) == 3, "usage invalidated")
            scenario(usage=20, normalFailure=False)
        previous = len(events("settled"))
        send("Fallback must compact original long history\r")
        wait(lambda: len(events("settled")) > previous and len(events("compact-request")) == 1
             and "Codex context compacted (automatic)." in view(), "usage local fallback compacted")
        assert any(item.get("type") == "compaction" for item in events("provider-request")[-1]["data"]["input"]), "Fallback request lost checkpoint"
        stop()
    elif case.startswith("legacy-"):
        kind = case.removeprefix("legacy-")
        seeded = subprocess.run(["node", str(Path(__file__).with_name("seed-legacy.mjs")), str(root), kind], cwd=repo,
                                env=env, capture_output=True, text=True, timeout=30)
        assert seeded.returncode == 0, seeded.stderr
        session = Path(json.loads(seeded.stdout)["session"])
        actions.append({"seed": "legacy", "kind": kind, "session": str(session)})
        before = checkpoints(session)
        start(["--session", str(session)])
        wait(lambda: len(events("ready")) == 1, "legacy CLI ready")
        send("/compact\r")
        if kind == "truncated":
            wait(lambda: "code=preserved_input_source_unproven" in view(), "legacy source rejection")
            assert checkpoints(session) == before, "Legacy rejection changed checkpoint"
            assert len(events("compact-request")) == 0, "Unproven legacy data reached service"
        else:
            wait(lambda: len(events("compacted")) == 1, "legacy migration applied")
            assert len(checkpoints(session)) == 2
            details = checkpoints(session)[-1]["details"]
            assert details.get("preservedInputSources"), "Migration did not persist provenance"
        send("Continue after legacy check\r")
        wait(lambda: len(events("settled")) == 1, "legacy continuation settled")
        if kind == "provable":
            assert "LEGACY_BEGIN_" + "x" * 280000 + "_LEGACY_END" in json.dumps(events("provider-request")[-1]["data"]), "Legacy pending input lost"
        else:
            assert checkpoints(session) == before, "Continuation changed refused legacy checkpoint"
        stop()
    passed = True
except BaseException as error:
    failure = {"type": type(error).__name__, "message": str(error)}
    screens["failure"] = view() if pid is not None else "Pi was not started"
    raise
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
    (evidence / "summary.json").write_text(json.dumps({"passed": passed, "case": case, "failure": failure, "command": args, "pids": children, "stopped": stopped,
        "actions": actions, "scratch": str(root), "cleanup": "removed" if not root.exists() else "unverified",
        "lockReleased": not owned_lock or not lock.exists(), "listeners": [],
        "driverSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, indent=2))
    assert all(stopped), "PTY child remains alive"
print(json.dumps({"passed": passed, "evidence": str(evidence)}))
