"""Exercise the real Pi dialog stack in normal and fullscreen terminals."""
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
import tempfile
import termios
import time
import pyte

repo = Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix="pi14-dialogs-", dir=repo / ".tmp") as temporary:
    root = Path(temporary)
    for name in ["home", "agent", "tmp"]:
        (root / name).mkdir()
    (root / "agent/settings.json").write_text(json.dumps({"defaultProjectTrust": "never", "tuiMode": "fullscreen" if "--fullscreen" in sys.argv else "regular"}))
    result = root / "results.json"
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(root)
        env = {"PATH": os.environ["PATH"], "TERM": "xterm-256color", "LANG": "en_US.UTF-8",
               "HOME": str(root / "home"), "TMPDIR": str(root / "tmp"), "PI_CODING_AGENT_DIR": str(root / "agent"),
               "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_DIALOG_RESULTS": str(result)}
        os.execvpe("node", ["node", str(repo / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
                    "--offline", "--no-session", "--no-extensions", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes",
                    "-e", str(repo / "extensions/permissions/__tests__/dialogs-fixture.ts"), "/acceptance-dialogs"], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 120, 0, 0))
    screen = pyte.Screen(120, 50)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    def view():
        return "\n".join(screen.display)
    def wait(predicate, label):
        end = time.monotonic() + 20
        while time.monotonic() < end:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    data = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b""
                if b"\x1b[6n" in data:
                    os.write(fd, b"\x1b[1;1R")
                stream.feed(decoder.decode(data))
            if predicate():
                return
        raise AssertionError(f"{label}\n{view()}")
    try:
        wait(lambda: "SECOND-PERMISSION" in view(), "Second selector did not open")
        os.write(fd, b"\r")
        wait(lambda: "FIRST-PERMISSION" in view() and "SECOND-PERMISSION" not in view(), "First selector was not restored")
        os.write(fd, b"\x1b[B\r")
        wait(lambda: "DIALOGS-DONE" in view(), "Dialog promises did not both resolve")
        assert json.loads(result.read_text()) == ["Allow", "Deny"]
        print(json.dumps({"check": "permission-dialog-stack", "fullscreen": "--fullscreen" in sys.argv, "results": ["Allow", "Deny"], "passed": True}))
    finally:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        os.close(fd)
