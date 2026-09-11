"""Check MCP history rendering in a version-pinned, isolated real Pi PTY."""
import argparse
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
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[3]
NODE = shutil.which("node")
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)")


def session(path, cwd, extra_tools=0):
    stamp = "2026-09-11T00:00:00.000Z"
    entries = [{"type": "session", "version": 3, "id": path.stem, "cwd": str(cwd), "timestamp": stamp}]
    def add(id, parent, message):
        entries.append({"type": "message", "id": id, "parentId": parent, "timestamp": stamp, "message": {**message, "timestamp": 1}})
    add("user0001", None, {"role": "user", "content": "Synthetic MCP history"})
    add("call0001", "user0001", {"role": "assistant", "content": [{"type": "toolCall", "id": "old-call", "name": "mcp__offline__old-tool", "arguments": {"query": "synthetic-argument"}}], "api": "openai-completions", "provider": "mcp-ui-host-fixture", "model": "ui-test", "stopReason": "toolUse", "usage": {"input": 1, "output": 1, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 2, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}})
    add("result01", "call0001", {"role": "toolResult", "toolCallId": "old-call", "toolName": "mcp__offline__old-tool", "content": [{"type": "text", "text": "synthetic-result"}], "details": {"mcp": True, "server": "offline", "tool": "old-tool"}, "isError": False})
    add("branch01", "user0001", {"role": "assistant", "content": [{"type": "toolCall", "id": "branch-call", "name": "mcp__branch__old__tool", "arguments": {}}], "api": "openai-completions", "provider": "mcp-ui-host-fixture", "model": "ui-test", "stopReason": "toolUse", "usage": entries[2]["message"]["usage"]})
    add("branchres", "branch01", {"role": "toolResult", "toolCallId": "branch-call", "toolName": "mcp__branch__old__tool", "content": [{"type": "text", "text": "branch-error"}], "isError": True})
    for index in range(extra_tools):
        add(f"extra{index}", None, {"role": "toolResult", "toolCallId": f"extra-call-{index}", "toolName": f"mcp__extra__tool{index}", "content": [{"type": "text", "text": "synthetic-extra"}], "isError": False})
    add("user0002", "result01", {"role": "user", "content": "Synthetic follow-up"})
    path.write_text("\n".join(json.dumps(entry) for entry in entries) + "\n")


def run_case(pi_root, baseline=False, live=False, cold_mode="session", repeat=0, memory=False, extra_tools=0):
    package = json.loads((pi_root / "package.json").read_text())
    assert package["version"] == "0.85.1", package["version"]
    cli = pi_root / "dist/bundle/cli.js"
    (ROOT / ".tmp").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mcp-resume-", dir=ROOT / ".tmp") as temporary:
        run = Path(temporary)
        for name in ["home", "agent", "cache", "tmp", "sessions"]:
            (run / name).mkdir()
        config = run / "mcp.json"
        config.write_text(json.dumps({"mcpServers": {"local": {"command": NODE,
            "args": [str(ROOT / "extensions/mcp/__tests__/fixtures/stdio-mcp-server.mjs")],
            "retry": {"maxAttempts": 1, "background": False}}} if live else {}}))
        history = run / "sessions" / "history.jsonl"
        imported = run / "import.jsonl"
        session(history, run, extra_tools)
        session(imported, run)
        other = run / "untrusted"
        (other / ".pi").mkdir(parents=True)
        cross = other / "cross.jsonl"
        session(cross, other)
        sentinel = run / "untrusted-command-ran"
        (other / ".pi/mcp.json").write_text(json.dumps({"mcpServers": {"unsafe": {"command": NODE,
            "args": ["-e", f"require('node:fs').writeFileSync({json.dumps(str(sentinel))}, 'unsafe')"],
            "retry": {"maxAttempts": 1, "background": False}}}}))
        extension = ROOT / "extensions/mcp/src/index.ts"
        if baseline:
            source = run / "baseline"
            shutil.copytree(ROOT / "extensions/mcp/src", source)
            (source / "index.ts").write_bytes(subprocess.check_output(["git", "show", "HEAD:extensions/mcp/src/index.ts"], cwd=ROOT))
            extension = source / "index.ts"
        env = {key: os.environ[key] for key in ["PATH", "LANG"] if key in os.environ}
        env.update({"TERM": "xterm-256color", "HOME": str(run / "home"), "TMPDIR": str(run / "tmp"),
                    "XDG_CACHE_HOME": str(run / "cache"), "JITI_FS_CACHE": str(run / "cache"),
                    "PI_CODING_AGENT_DIR": str(run / "agent"), "PI_CODING_AGENT_SESSION_DIR": str(run / "sessions"),
                    "PI_MCP_CONFIG": str(config), "PI_OFFLINE": "1", "PI_TELEMETRY": "0",
                    "MCP_HISTORY_UNTRUSTED_CWD": str(other), "MCP_HISTORY_LIVE": "1" if live else "0", "MCP_HISTORY_TRACE": str(run / "trace.jsonl")})
        args = [NODE, str(cli), "--no-extensions", "--extension", str(extension), "--extension",
                str(ROOT / "extensions/mcp/__tests__/fixtures/resume-ui-extension.ts"), "--session-dir", str(run / "sessions"),
                "--no-context-files", "--no-skills", "--no-prompt-templates", "--offline"]
        args += ["--no-session", "--provider", "mcp-ui-host-fixture", "--model", "ui-test"] if memory else ["--session", str(history)] if cold_mode == "session" else [f"--{cold_mode}"]
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(run)
            os.execve(NODE, args, env)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 120, 0, 0))
        exited = False
        output = ""
        timings = {}
        owned_children = set()

        def remember_children():
            rows = subprocess.check_output(["ps", "-axo", "pid=,ppid="], text=True)
            parents = {int(row.split()[0]): int(row.split()[1]) for row in rows.splitlines()}
            family = {pid}
            while True:
                children = {child for child, parent in parents.items() if parent in family}
                if children <= family:
                    break
                family |= children
            owned_children.update(family - {pid})

        def receive(seconds):
            nonlocal output
            chunks = []
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                if select.select([fd], [], [], 0.05)[0]:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    if b"\x1b[6n" in data:
                        os.write(fd, b"\x1b[1;1R")
                    chunks.append(data)
            text = ANSI.sub("", b"".join(chunks).decode("utf-8", "replace"))
            output += text
            assert "Extension error" not in text, text
            return text

        def until(expected):
            text = ""
            deadline = time.monotonic() + (120 if extra_tools else 20)
            while expected not in text and time.monotonic() < deadline:
                text += receive(0.1)
            assert expected in text, f"Missing {expected!r}: {text!r}"
            return text + receive(0.3)

        def replacement(name, command):
            start = time.monotonic()
            os.write(fd, ("\x15" + command + "\r").encode())
            if name == "import":
                until("Replace current session")
                os.write(fd, b"\r")
            text = until("MCP UI host ready")
            timings[name] = round(time.monotonic() - start, 3)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 119, 0, 0))
            os.kill(pid, signal.SIGWINCH)
            receive(0.3)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 120, 0, 0))
            os.kill(pid, signal.SIGWINCH)
            text = receive(0.3)
            check(text, name)

        def check(text, scene):
            server_tool = "local / echo" if live else "offline / old-tool"
            full_name = "mcp__local__echo" if live else "mcp__offline__old-tool"
            if baseline:
                assert f"Called {server_tool}" not in text, (scene, text)
                assert full_name in text and ('"text"' if live else '"query"') in text, (scene, text)
            else:
                assert f"Called {server_tool}" in text, (scene, text)
                assert ('"text"' if live else '"query": "synthetic-argument"') not in text, (scene, text)

        try:
            start = time.monotonic()
            if cold_mode == "resume":
                until("Synthetic MCP history")
                os.write(fd, b"\r")
            text = until("MCP UI host ready")
            timings["cold"] = round(time.monotonic() - start, 3)
            remember_children()
            if live:
                os.write(fd, b"Run the fixture call\r")
                live_text = until("MCP-LIVE-DONE")
                assert "Called local / echo" in live_text, live_text
                trace = [json.loads(line) for line in (run / "trace.jsonl").read_text().splitlines()]
                assert len(trace) == 1 and not trace[0]["isError"], trace
                assert trace[0]["details"]["mcp"] is True
                config.write_text('{"mcpServers":{}}')
                if memory:
                    replacement("clone-memory", "/fixture-clone-last")
                    os.write(fd, b"/fixture-empty-fork\r")
                    until("Run the fixture call")
                else:
                    os.write(fd, b"/fixture-new\r")
                    until("MCP 0/0 online")
                    replacement("resume-live-offline", f"/fixture-resume {history}")
                assert len((run / "trace.jsonl").read_text().splitlines()) == 1
            elif extra_tools:
                check(text, "cold")
            else:
                check(text, "cold")
                replacement("reload", "/reload")
                replacement("resume", f"/fixture-resume {history}")
                replacement("import", f"/import {imported}")
                os.write(fd, (f"/fixture-cancel {history}\r").encode())
                until("MCP-SWITCH-CANCELLED")
                assert not list((run / "agent").glob("mcp-history/*.json"))
                os.write(fd, b"/fixture-tree branchres\r")
                tree = until("branch-error")
                if not baseline:
                    assert "Call failed for mcp__branch__old__tool" in tree, tree
                os.write(fd, b"\x15/fixture-tree result01\r")
                until("synthetic-result")
                replacement("clone", "/fixture-clone user0002")
                replacement("fork", "/fixture-fork user0002")
                replacement("cross-cwd", f"/fixture-cross {cross}")
                assert "This project is not trusted" in output, output[-5000:]
                assert not sentinel.exists()
            resources = []
            for iteration in range(repeat):
                replacement(f"repeat-{iteration}", "/reload")
                assert not list((run / "agent").glob("mcp-history/*.json"))
                rss = int(subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)], text=True).strip())
                descriptors = subprocess.check_output(["lsof", "-p", str(pid), "-Ff"], text=True)
                resources.append({"rss_kib": rss, "fds": len([line for line in descriptors.splitlines() if re.match(r"f[0-9]+$", line)])})
            if resources:
                assert len({item["fds"] for item in resources}) == 1, resources
            os.write(fd, b"\x15/mcp-ui-quit\r")
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                receive(0.1)
                result, status, usage = os.wait4(pid, os.WNOHANG)
                if result:
                    exited = True
                    assert os.waitstatus_to_exitcode(status) == 0, output
                    break
            assert exited, "Host failed to exit cleanly"
            for child in owned_children:
                try:
                    os.kill(child, 0)
                except ProcessLookupError:
                    continue
                raise AssertionError(f"Task-owned child {child} survived shutdown")
            assert str(run) not in subprocess.check_output(["ps", "-axo", "command="], text=True)
            leftovers = list((run / "agent").glob("mcp-history/*"))
            assert not leftovers, leftovers
            print(json.dumps({"pi": package["version"], "baseline": baseline, "live": live, "memory": memory, "extra_tools": extra_tools, "cold_mode": cold_mode, "timings_seconds": timings,
                              "peak_rss": usage.ru_maxrss, "pid": pid, "exited": exited, "ports": [], "repeat_resources": resources, "child_pids_exited": sorted(owned_children), "handoff_files": len(leftovers)}))
        finally:
            if not exited:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            for child in owned_children:
                try:
                    os.kill(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            os.close(fd)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pi-root", type=Path, required=True)
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--cold-mode", choices=["session", "continue", "resume"], default="session")
    parser.add_argument("--repeat", type=int, default=0)
    parser.add_argument("--memory", action="store_true")
    parser.add_argument("--extra-tools", type=int, default=0)
    options = parser.parse_args()
    run_case(options.pi_root, options.baseline, options.live or options.memory, options.cold_mode, options.repeat, options.memory, options.extra_tools)
