"""Exercise real MCP startup in Pi's PTY, using only local stdio servers."""
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
FIXTURES = ROOT / "extensions/mcp/__tests__/fixtures"
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)")
NODE = shutil.which("node")
CLI = ROOT / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"


def run_case(scene, baseline=False, theme="codex-pi", measure=False):
    (ROOT / ".tmp").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mcp-ui-host-", dir=ROOT / ".tmp") as temporary:
        run = Path(temporary)
        for name in ["home", "agent", "cache", "tmp"]:
            (run / name).mkdir()
        names = ["mysql"] if scene == "single" else ["alpha", "beta", "gamma", "mysql"]
        servers = {}
        for i, name in enumerate(names):
            delay = 4000 if name == "mysql" else 700 * (i + 1)
            args = [str(FIXTURES / "stdio-mcp-server.mjs"), "delay-tools", str(delay)]
            if scene == "failed" and name == "mysql":
                args = [str(FIXTURES / "stdio-mcp-server.mjs"), "exit-early"]
            servers[name] = {"command": NODE, "args": args, "connectTimeout": 12000,
                             "retry": {"maxAttempts": 1, "background": False}}
        config = run / "mcp.json"
        config.write_text(json.dumps({"mcpServers": servers}))
        extension = ROOT / "extensions/mcp/src/index.ts"
        if baseline:
            source = run / "baseline"
            shutil.copytree(ROOT / "extensions/mcp/src", source)
            for name in ["index.ts", "client.ts"]:
                original = subprocess.check_output(["git", "show", f"HEAD:extensions/mcp/src/{name}"], cwd=ROOT)
                (source / name).write_bytes(original)
            extension = source / "index.ts"
        env = {key: os.environ[key] for key in ["PATH", "LANG"] if key in os.environ}
        env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "HOME": str(run / "home"),
                    "TMPDIR": str(run / "tmp"), "XDG_CACHE_HOME": str(run / "cache"),
                    "JITI_FS_CACHE": str(run / "cache"), "PI_CODING_AGENT_DIR": str(run / "agent"),
                    "PI_CODING_AGENT_SESSION_DIR": str(run / "agent"), "PI_MCP_CONFIG": str(config),
                    "PI_OFFLINE": "1", "PI_TELEMETRY": "0"})
        args = [NODE, str(CLI), "--no-extensions",
                "--extension", str(ROOT / "extensions/codex-ui/src/index.ts"),
                "--extension", str(extension), "--extension", str(FIXTURES / "ui-host-extension.ts"),
                "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates",
                "--offline", "--approve"]
        if theme == "codex-pi":
            args += ["--theme", str(ROOT / "themes/codex-pi.json"), "--use-theme", theme]
        else:
            args += ["--use-theme", theme]
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(run)
            os.execve(NODE, args, env)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 120, 0, 0))
        exited = False
        all_output = ""
        owned_children = set()
        started = time.monotonic()

        def remember_children():
            rows = subprocess.check_output(["ps", "-axo", "pid=,ppid="], text=True)
            parents = {int(row.split()[0]): int(row.split()[1]) for row in rows.splitlines()}
            family = {pid}
            while True:
                descendants = {child for child, parent in parents.items() if parent in family}
                if descendants <= family:
                    break
                family |= descendants
            owned_children.update(family - {pid})

        def receive(seconds):
            nonlocal all_output
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
            all_output += text
            assert "Extension error" not in text, text
            return text

        def until(expected, timeout=15):
            text = ""
            deadline = time.monotonic() + timeout
            while expected not in text and time.monotonic() < deadline:
                text += receive(0.1)
            assert expected in text, f"Missing {expected!r}: {text!r}"
            return text

        def command(text, expected):
            os.write(fd, (text + "\r").encode())
            return until(expected)

        try:
            if not baseline:
                header = "Booting MCP server: mysql" if scene == "single" else "Starting MCP servers (0/4)"
                until(header)
                remember_children()
                if scene == "interrupt":
                    until("Starting MCP servers (3/4): mysql")
                    os.write(fd, b"\x1b")
                    until("MCP startup interrupted (cancelled: mysql)")
            until("MCP UI host ready")
            remember_children()
            startup_elapsed = time.monotonic() - started
            if not baseline and not measure:
                assert all_output.count("Booting MCP server" if scene == "single" else "Starting MCP servers") > 1
                if scene == "ready":
                    assert "Starting MCP servers (3/4): mysql" in all_output
                    assert "MCP startup:" not in all_output
                if scene == "failed":
                    assert "MCP startup incomplete (failed: mysql)" in all_output
                state = "cancelled" if scene == "interrupt" else "failed" if scene == "failed" else "connected"
                command("/mcp", f"mysql: {state}")
                verbose = command("/mcp verbose", "Tools: echo")
                assert "Auth:" not in verbose and "Resources:" not in verbose
                if scene == "interrupt":
                    command("/mcp reconnect mysql", "MCP server reconnected: mysql")
                    command("/mcp", "mysql: connected")
                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 40, 0, 0))
                os.kill(pid, signal.SIGWINCH)
                receive(0.3)
                command("/mcp", "MCP Tools")
            idle = receive(0.4)
            assert "Starting MCP servers" not in idle and "Booting MCP server" not in idle, idle
            os.write(fd, b"/mcp-ui-quit\r")
            deadline = time.monotonic() + 8
            usage = None
            while time.monotonic() < deadline:
                receive(0.1)
                result, status, usage = os.wait4(pid, os.WNOHANG)
                if result:
                    exited = True
                    assert os.waitstatus_to_exitcode(status) == 0, all_output
                    break
            assert exited, "Host failed to exit cleanly"
            processes = subprocess.check_output(["ps", "-axo", "command="], text=True)
            assert str(run) not in processes, "A task-owned host process survived shutdown"
            for child in owned_children:
                try:
                    os.kill(child, 0)
                except ProcessLookupError:
                    continue
                raise AssertionError(f"Task-owned child {child} survived shutdown")
            print(json.dumps({"scene": scene, "baseline": baseline, "theme": theme,
                              "startup_seconds": round(startup_elapsed, 3),
                              "cpu_seconds": round(usage.ru_utime + usage.ru_stime, 3),
                              "startup_header_occurrences": all_output.count("Starting MCP servers")}, ensure_ascii=False), flush=True)
        finally:
            if not exited:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.waitpid(pid, 0)
            os.close(fd)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--measure", action="store_true")
    parser.add_argument("--scene", choices=["ready", "single", "failed", "interrupt"])
    options = parser.parse_args()
    if options.baseline:
        run_case("ready", baseline=True, measure=True)
    elif options.measure:
        run_case("ready", measure=True)
    elif options.scene:
        run_case(options.scene)
    else:
        for case in ["ready", "single", "failed", "interrupt"]:
            run_case(case)
        run_case("ready", theme="light")
