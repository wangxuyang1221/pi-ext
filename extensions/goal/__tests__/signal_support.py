"""Register PTY owners before signals resume and unwind drivers on termination."""
import atexit
import json
import os
from pathlib import Path
import pty
import signal
import time


def install(evidence, state=None):
    root = Path(evidence)
    root.mkdir(parents=True, exist_ok=True)
    creator = os.getpid()
    owners = []
    interrupted = False
    original_fork = pty.fork
    watched = {signal.SIGTERM, signal.SIGINT}
    owner_file = root / "owned-pty-pids.json"
    state = state if state is not None else {}

    def capture():
        # Save before unwinding: a driver may need its full grace period to stop Pi.
        for name in ("actions", "screens"):
            if name in state:
                try:
                    (root / f"{name}.json").write_text(json.dumps(state[name], ensure_ascii=False, indent=2))
                except (OSError, TypeError, ValueError):
                    pass
        if isinstance(state.get("output"), (bytes, bytearray)):
            try:
                (root / "signal-terminal.ansi").write_bytes(state["output"])
            except OSError:
                pass
        try:
            if callable(state.get("view")):
                (root / "signal-screen.txt").write_text(state["view"]())
            if state.get("transcript"):
                state["transcript"].flush()
        except (OSError, ValueError, RuntimeError):
            pass

    def save_owners():
        temporary = root / f".owned-pty-pids-{creator}.tmp"
        temporary.write_text(json.dumps(owners))
        temporary.replace(owner_file)

    def terminate(signum, _frame):
        nonlocal interrupted
        with (root / "signals.jsonl").open("a") as log:
            log.write(json.dumps({"pid": os.getpid(), "signal": signum}) + "\n")
        if not interrupted:
            interrupted = True
            capture()
            raise SystemExit(128 + signum)

    def owned_fork():
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, watched)
        try:
            pid, fd = original_fork()
            if pid == 0:
                # The exec child gets normal signal behavior and cannot clean siblings.
                for signum in watched:
                    signal.signal(signum, signal.SIG_DFL)
            else:
                owners.append(pid)
                save_owners()
            return pid, fd
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)

    def cleanup():
        if os.getpid() != creator:
            return
        for signum in watched:
            signal.signal(signum, signal.SIG_IGN)
        capture()
        errors = []

        def alive(pid):
            try:
                os.killpg(pid, 0)
                return True
            except ProcessLookupError:
                return False
            except PermissionError:
                return True

        for signum, duration in ((signal.SIGTERM, 0.5), (signal.SIGKILL, 2)):
            for pid in owners:
                if alive(pid):
                    try:
                        os.killpg(pid, signum)
                    except ProcessLookupError:
                        pass
                    except PermissionError as error:
                        errors.append(str(error))
            deadline = time.monotonic() + duration
            while any(alive(pid) for pid in owners) and time.monotonic() < deadline:
                for pid in owners:
                    try:
                        os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        pass
                time.sleep(0.02)
        try:
            (root / "signal-cleanup.json").write_text(json.dumps({"pids": owners, "groupStopped": not any(alive(pid) for pid in owners), "errors": errors}))
        except OSError:
            pass

    save_owners()
    pty.fork = owned_fork
    for signum in watched:
        signal.signal(signum, terminate)
    atexit.register(cleanup)
