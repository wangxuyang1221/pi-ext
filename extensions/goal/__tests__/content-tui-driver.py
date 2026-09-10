"""Exercise native Pi paste, selection, summary and editor in two real PTY processes."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import signal
import sys
import time
import fcntl
import struct
import termios

root = Path(sys.argv[1]).resolve()
package = str(Path(sys.argv[2]).resolve())
root.mkdir(parents=True, exist_ok=True)
assert not (root / "pids.json").exists(), "Use a fresh evidence directory"
pids = []
results = []
for phase in ("create", "reopen"):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update({"GOAL_UI_ROOT": str(root), "GOAL_UI_PHASE": phase, "TERM": "xterm-256color", "PI_OFFLINE": "1", "PI_TELEMETRY": "0"})
        os.execvp("node", ["node", "extensions/goal/__tests__/content-tui.mjs", package])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    os.set_blocking(fd, False)
    pids.append(pid)
    (root / "pids.json").write_text(json.dumps(pids))
    status = None
    transcript = (root / f"terminal-{phase}.ansi").open("wb")
    output = bytearray()
    event_path = root / f"events-{phase}.jsonl"

    def pump():
        global status
        ready, _, _ = select.select([fd], [], [], 0.05)
        if ready:
            try:
                data = os.read(fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b""
            output.extend(data)
            transcript.write(data)
            transcript.flush()
        if status is None:
            done, value = os.waitpid(pid, os.WNOHANG)
            if done:
                status = value

    def events():
        return event_path.read_text() if event_path.exists() else ""

    def wait(predicate, label):
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            pump()
            if predicate():
                return
            if status is not None:
                raise AssertionError(f"Process exited before {label}: {status}")
        raise TimeoutError(label)

    def send(data):
        offset = 0
        deadline = time.monotonic() + 10
        while offset < len(data):
            assert time.monotonic() < deadline, "PTY input stalled"
            try:
                offset += os.write(fd, data[offset:offset + 512])
            except BlockingIOError:
                pass
            pump()

    def command(text):
        send(text.encode() + b"\r")

    try:
        wait(lambda: '"event":"ready"' in events(), "ready")
        time.sleep(0.3)
        command("/probe-begin")
        wait(lambda: '"event":"begin"' in events(), "baseline")
        if phase == "create":
            text = "/goal GOAL_LONG_BEGIN " + "Check the selected screenshot. " * 180 + " IMAGE "
            send(b"\x1b[200~" + text.encode() + b"\x1b[201~")
            time.sleep(0.2)
            send(b"\x16")
            wait(lambda: '"event":"fixture_clipboard_image"' in events(), "native clipboard paste")
            time.sleep(0.2)
            send(b"\r")
            wait(lambda: b"Persist pasted image?" in output, "attachment selection")
            send(b"\r")
            wait(lambda: '"event":"settled"' in events(), "automatic offline completion")
            command("/goal pause")
            wait(lambda: b"Goal paused." in output, "pause")
        else:
            command("/goal")
            wait(lambda: b"GOAL_LONG_BEGIN" in output and b"Preview truncated" in output, "native summary")
            command("/goal edit")
            wait(lambda: '"event":"native_editor"' in events(), "native editor")
            time.sleep(0.2)
            send(b"\x05 EDITED_AFTER_REOPEN\r")
            wait(lambda: b"Goal updated." in output, "edit saved")
        time.sleep(0.2)
        command("/probe-exit")
        wait(lambda: status is not None, "graceful exit")
        assert os.waitstatus_to_exitcode(status) == 0
        records = [json.loads(line) for line in events().splitlines()]
        result = next(record for record in records if record["event"] == "result")
        results.append(result)
        assert b"Goal: paused" in output
        if phase == "reopen":
            editor = next(record for record in records if record["event"] == "native_editor")
            assert editor["prefill"] == json.loads((root / "saved.json").read_text())["expanded"]
        else:
            assert b"Copy attachment" in output
    finally:
        if status is None:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for _ in range(30):
                pump()
                if status is not None:
                    break
            if status is None:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                _, status = os.waitpid(pid, 0)
        transcript.close()
        os.close(fd)
        (root / "cleanup.json").write_text(json.dumps({"pids": pids, "exited": True, "lastStatus": status}))
(root / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({"root": str(root), "phases": len(results), "pids": pids, "passed": True}))
