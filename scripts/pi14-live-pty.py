"""Run live SDK acceptance with the real Pi interactive UI on a private PTY."""
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

node, worker, stage = sys.argv[1:]
root = Path(os.environ["PI14_LIVE_ROOT"])
result = root / f"{stage}.worker.jsonl"
result.unlink(missing_ok=True)
deadline = json.loads(Path(os.environ["PI14_LIVE_STATE"]).read_text())["deadline"] / 1000
pid, fd = pty.fork()
if pid == 0:
    os.environ["PI14_LIVE_TUI"] = "1"
    os.execv(node, [node, worker, stage])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 120, 0, 0))
status = None
tail = bytearray()
interrupted = False
def stop(_signal, _frame):
    global interrupted
    interrupted = True
    raise KeyboardInterrupt
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while status is None and time.time() < deadline:
        if select.select([fd], [], [], 0.05)[0]:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if b"\x1b[6n" in data:
                os.write(fd, b"\x1b[1;1R")
            tail.extend(data)
            tail = tail[-8000:]
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        end = time.monotonic() + 3
        while time.monotonic() < end:
            done, value = os.waitpid(pid, os.WNOHANG)
            if done:
                status = value
                break
            time.sleep(0.05)
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            _, status = os.waitpid(pid, 0)
    os.close(fd)
    if result.exists():
        print(result.read_text(), end="")
    code = os.waitstatus_to_exitcode(status)
    if code:
        print(tail.decode("utf8", "replace"), file=sys.stderr)
    sys.exit(1 if interrupted or code < 0 else code)
