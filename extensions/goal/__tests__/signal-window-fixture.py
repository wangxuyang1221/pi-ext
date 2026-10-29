"""Deliver SIGTERM inside fork, before the caller can record its returned PID."""
import os
from pathlib import Path
import pty
import signal
import sys
import time
from signal_support import install

root = Path(sys.argv[1])
original_fork = pty.fork


def interrupt_before_registration():
    pid, fd = original_fork()
    if pid > 0:
        os.kill(os.getpid(), signal.SIGTERM)
    return pid, fd


pty.fork = interrupt_before_registration
install(root)
pid, fd = pty.fork()
if pid == 0:
    time.sleep(60)
else:
    raise AssertionError("Pending SIGTERM must be handled after owner registration")
