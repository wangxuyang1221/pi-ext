"""Measure actual Pi PTY input with synthetic MCP history and a local MCP server."""
import argparse
import codecs
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


def make_history(path, cwd, count):
    stamp = "2026-09-29T00:00:00.000Z"
    entries = [{"type": "session", "version": 3, "id": "render-fixture", "cwd": str(cwd), "timestamp": stamp}]
    parent = None

    def add(message):
        nonlocal parent
        entry_id = f"entry-{len(entries)}"
        entries.append({"type": "message", "id": entry_id, "parentId": parent, "timestamp": stamp, "message": message})
        parent = entry_id

    add({"role": "user", "content": [{"type": "text", "text": "Synthetic render history"}], "timestamp": 1})
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
             "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}
    for index in range(count):
        call_id = f"call-{index}"
        add({"role": "assistant", "content": [{"type": "toolCall", "id": call_id, "name": "mcp__local__echo", "arguments": {"text": f"row-{index} 中文🙂"}}],
             "api": "openai-completions", "provider": "mcp-render-fixture", "model": "render-test", "stopReason": "toolUse", "usage": usage, "timestamp": 1})
        add({"role": "toolResult", "toolCallId": call_id, "toolName": "mcp__local__echo",
             "content": [{"type": "text", "text": json.dumps({"row": index, "text": "中文🙂é layout preview " * 80}, ensure_ascii=False)}],
             "details": {"mcp": True, "server": "local", "tool": "echo"}, "isError": False, "timestamp": 1})
    path.write_text("\n".join(json.dumps(entry, ensure_ascii=False) for entry in entries) + "\n")


def run(options):
    (ROOT / ".tmp").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mcp-render-input-", dir=ROOT / ".tmp") as directory:
        work = Path(directory)
        for name in ["home", "agent", "cache", "tmp", "sessions"]:
            (work / name).mkdir()
        (work / "agent/settings.json").write_text(json.dumps({"terminal": {"showImages": False}, "compaction": {"enabled": False}}))
        config = work / "mcp.json"
        config.write_text(json.dumps({"mcpServers": {"local": {"command": NODE, "args": [str(FIXTURES / "stdio-mcp-server.mjs")], "retry": {"maxAttempts": 1, "background": False}}}}))
        history = work / "sessions/history.jsonl"
        make_history(history, work, options.rows)
        extension = ROOT / "extensions/mcp/src/index.ts"
        if options.baseline:
            source = work / "source"
            shutil.copytree(extension.parent, source)
            (source / "renderers.ts").write_bytes(subprocess.check_output(["git", "show", "HEAD:extensions/mcp/src/renderers.ts"], cwd=ROOT))
            extension = source / "index.ts"
        environment = {key: os.environ[key] for key in ["PATH", "LANG"] if key in os.environ}
        environment.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "HOME": str(work / "home"),
                            "TMPDIR": str(work / "tmp"), "XDG_CACHE_HOME": str(work / "cache"), "JITI_FS_CACHE": str(work / "cache"),
                            "PI_CODING_AGENT_DIR": str(work / "agent"), "PI_CODING_AGENT_SESSION_DIR": str(work / "sessions"),
                            "PI_MCP_CONFIG": str(config), "PI_OFFLINE": "1", "PI_TELEMETRY": "0"})
        if options.profile_dir:
            environment["MCP_RENDER_PROFILE"] = str(work / "render.cpuprofile")
        cli = options.pi_root / "dist/bundle/cli.js"
        argv = [NODE, str(cli), "--no-extensions", "--extension", str(ROOT / "extensions/codex-ui/src/index.ts"),
                "--extension", str(extension), "--extension", str(FIXTURES / "render-input-extension.ts"),
                "--session", str(history), "--provider", "mcp-render-fixture", "--model", "render-test",
                "--no-context-files", "--no-skills", "--no-prompt-templates", "--offline", "--approve",
                "--theme", str(ROOT / "themes/codex-pi.json"), "--use-theme", "codex-pi"]
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(work)
            os.execve(NODE, argv, environment)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, options.width, 0, 0))
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        transcript = ""
        exited = False
        children = set()

        def receive(timeout):
            nonlocal transcript
            if select.select([fd], [], [], timeout)[0]:
                try:
                    data = os.read(fd, 262144)
                except OSError:
                    return ""
                if b"\x1b[6n" in data:
                    os.write(fd, b"\x1b[1;1R")
                text = decoder.decode(data)
                transcript += text
                assert "Extension error" not in text and "Extension issues" not in text, text
                return text
            return ""

        def until(marker, start, timeout=45):
            deadline = time.monotonic() + timeout
            while marker not in ANSI.sub("", transcript[start:]):
                assert time.monotonic() < deadline, f"Missing marker: {marker}\n{ANSI.sub('', transcript[-8000:])}"
                receive(0.01)

        def settle(seconds=0.2):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                receive(0.01)

        def measure(mode):
            samples = []
            for index in range(30):
                marker = f"probe-{mode}-{index:02d}"
                start_index = len(transcript)
                started = time.monotonic()
                os.write(fd, marker.encode())
                until(marker, start_index, 10)
                samples.append((time.monotonic() - started) * 1000)
                os.write(fd, b"\x15")
                settle(0.04)
            samples.sort()
            return {"p50ms": round(samples[15], 3), "p95ms": round(samples[28], 3)}

        try:
            until("Ask Pi to do anything", 0)
            os.write(fd, b"/render-ready\r")
            until("RENDER-HOST-READY", 0)
            settle()
            rows = subprocess.check_output(["ps", "-axo", "pid=,ppid="], text=True)
            parents = {int(row.split()[0]): int(row.split()[1]) for row in rows.splitlines()}
            family = {pid}
            while True:
                descendants = {child for child, parent in parents.items() if parent in family}
                if descendants <= family:
                    break
                family |= descendants
            children = family - {pid}
            if options.profile_dir:
                start = len(transcript)
                os.write(fd, b"/render-profile-start\r")
                until("RENDER-PROFILE-READY", start)
                settle()
            waiting = measure("waiting")
            settle()
            start = len(transcript)
            os.write(fd, b"Run local echo and stream\r")
            until("STREAMING-START", start)
            assert "MCP-TRANSPORT-OK" in ANSI.sub("", transcript[start:])
            streaming = measure("streaming")
            assert "STREAMING-DONE" not in ANSI.sub("", transcript[start:]), "Streaming ended before input measurement completed"
            until("STREAMING-DONE", start)
            settle()
            os.write(fd, b"\x15/render-quit\r")
            deadline = time.monotonic() + 10
            usage = None
            while time.monotonic() < deadline:
                receive(0.02)
                done, status, usage = os.wait4(pid, os.WNOHANG)
                if done:
                    exited = True
                    assert os.waitstatus_to_exitcode(status) == 0
                    break
            assert exited, "Host did not exit"
            for child in children:
                try:
                    os.kill(child, 0)
                except ProcessLookupError:
                    continue
                raise AssertionError(f"Child still running: {child}")
            version = json.loads((options.pi_root / "package.json").read_text())["version"]
            report = {"pi": version, "baseline": options.baseline, "rows": options.rows, "width": options.width,
                      "waiting": waiting, "streaming": streaming, "cpuSeconds": round(usage.ru_utime + usage.ru_stime, 3),
                      "pid": pid, "exited": True, "childrenExited": sorted(children), "ports": []}
            if options.profile_dir:
                profile = json.loads((work / "render.cpuprofile").read_text())
                nodes = {node["id"]: node for node in profile["nodes"]}
                parents = {child: node["id"] for node in profile["nodes"] for child in node.get("children", [])}
                total = idle = mcp = 0
                for sample, delta in zip(profile["samples"], profile["timeDeltas"]):
                    total += delta
                    if nodes[sample]["callFrame"]["functionName"] == "(idle)":
                        idle += delta
                    current = sample
                    while current:
                        url = nodes[current]["callFrame"]["url"]
                        if re.search(r"/(?:mcp/(?:src|dist)|source)/renderers\.(?:ts|js)$", url):
                            mcp += delta
                            break
                        current = parents.get(current)
                options.profile_dir.mkdir(parents=True, exist_ok=True)
                destination = options.profile_dir / ("baseline.cpuprofile" if options.baseline else "cached.cpuprofile")
                shutil.copyfile(work / "render.cpuprofile", destination)
                report["profile"] = {"file": str(destination), "mcpPercent": round(100 * mcp / total, 2),
                                     "mcpNonIdlePercent": round(100 * mcp / (total - idle), 2), "idlePercent": round(100 * idle / total, 2)}
            print(json.dumps(report), flush=True)
            if options.check:
                assert waiting["p95ms"] < 50 and streaming["p95ms"] < 50, report
        finally:
            if not exited:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.waitpid(pid, 0)
            for child in children:
                try:
                    os.kill(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            os.close(fd)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pi-root", type=Path, default=ROOT / "node_modules/@earendil-works/pi-coding-agent")
    parser.add_argument("--rows", type=int, default=500)
    parser.add_argument("--width", type=int, default=120)
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--check", action="store_true")
    run(parser.parse_args())
