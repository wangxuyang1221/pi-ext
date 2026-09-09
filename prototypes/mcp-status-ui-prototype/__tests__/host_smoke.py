"""Exercise the real Pi CLI in a POSIX PTY without model or MCP traffic."""
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import termios
import time

ROOT = Path(__file__).resolve().parents[3]
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)")


def main():
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        os.execvp("node", ["node", "prototypes/mcp-status-ui-prototype/demo.mjs"])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 100, 0, 0))
    exited = False

    def receive(seconds):
        chunks = []
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([fd], [], [], 0.1)[0]:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                if b"\x1b[6n" in data:
                    os.write(fd, b"\x1b[1;1R")
                chunks.append(data)
        return ANSI.sub("", b"".join(chunks).decode("utf-8", "replace"))

    def command(text, expected, seconds=0.8):
        os.write(fd, (text + "\r").encode())
        output = receive(seconds)
        assert expected in output, f"Missing {expected!r} after {text!r}: {output!r}"
        assert "Extension error" not in output, output
        print(f"PASS {text}", flush=True)
        return output

    try:
        startup = receive(6)
        assert "MCP ready" in startup, startup
        assert "No models available" not in startup, startup
        assert "ui-preview" in startup, startup
        print("PASS isolated real Pi startup", flush=True)
        command("/mcp-ui 2", "SERVER")
        command("/mcp-scene failed", "Connection timed out")
        command("/mcp-ui 3", "MCP partially connected")
        command("/mcp-scene ready", "MCP connected")
        details = command("/mcp-details", "MCP servers")
        assert "4/4" not in details, details
        command("/mcp-scene failed", "10 tools available")
        command("/mcp-scene ready", "13 tools")
        saved = command("/mcp", "fixture snapshot")
        assert "MCP servers" in saved and "4/4" not in saved, saved
        compared = command("/mcp-ui compare", "01 / Minimal status")
        assert "02 / Compact table" in compared and "03 / Connection progress" in compared, compared
        command("/mcp-details", "MCP connected")
        replay = command("/mcp-play", "0/4", 5.5)
        assert "attempt 2" in replay and "13 tools" in replay, replay
        reference = command("/mcp-ui codex", "MCP Tools")
        assert "MultiFetch: connected (5 tools)" in reference, reference
        command("/mcp", "Use /mcp verbose for tools and resources.")
        command("/mcp verbose", "Resource templates: (none)")
        command("/mcp-scene failed", "mysql: failed (0 tools)")
        startup = command("/mcp-play", "Starting MCP servers (0/4)", 1.0)
        assert startup.count("Starting MCP servers") > 1, "Startup animation did not repaint"
        progress = receive(4.5)
        assert "Starting MCP servers (3/4): mysql" in progress, progress
        command("/mcp", "mysql: connected (3 tools)")
        command("/mcp-play single", "Booting MCP server: mysql")
        os.write(fd, b"\x1b")
        interrupted = receive(0.8)
        assert "MCP startup interrupted." in interrupted, interrupted
        command("/mcp", "mysql: cancelled (0 tools)")
        failed = command("/mcp-play failed", "Starting MCP servers", 5.5)
        assert "MCP startup incomplete (failed: mysql)" in failed, failed
        command("/mcp-play", "Starting MCP servers")
        command("/mcp-ui 3", "Connecting MCP servers")
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 40, 0, 0))
        os.kill(pid, signal.SIGWINCH)
        receive(0.5)
        command("/mcp-ui 1", "Minimal status")
        command("hello", "UI prototype only")
        os.write(fd, b"/mcp-quit\r")
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            receive(0.2)
            result, status = os.waitpid(pid, os.WNOHANG)
            if result:
                exited = True
                assert os.waitstatus_to_exitcode(status) == 0, status
                break
        assert exited, "Prototype did not shut down cleanly"
        print("PASS clean shutdown", flush=True)
    finally:
        if not exited:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
        os.close(fd)


if __name__ == "__main__":
    main()
