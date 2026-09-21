"""Probe the real Pi quit entry without starting real subagents."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import termios
import time

repo = Path(__file__).resolve().parents[3]
results = []
for host, mode in [('native', 'regular'), ('native', 'fullscreen'), ('codex', 'regular'), ('combined', 'regular'), ('combined', 'fullscreen'), ('reverse', 'regular')]:
    for choice in ['Leave temporarily', 'End session']:
        report = repo / f'.tmp/subagent-cleanup/quit-{host}-{mode}-{choice.replace(" ", "-")}.jsonl'
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(repo)
            os.environ['QUIT_PROBE_REPORT'] = str(report)
            os.execvp('node', ['node', 'adventure/prototypes/quit-choice/run.mjs', host, mode])
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
        output, status, root = bytearray(), None, None
        def wait(predicate):
            global status
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                if select.select([fd], [], [], 0.05)[0]:
                    try:
                        output.extend(os.read(fd, 65536))
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                if status is None:
                    done, value = os.waitpid(pid, os.WNOHANG)
                    if done:
                        status = value
                if predicate():
                    return
            raise AssertionError(output.decode(errors='replace')[-6000:])
        def events(kind):
            path = root / 'events.jsonl'
            return [item['data'] for line in path.read_text().splitlines() if (item := json.loads(line))['type'] == kind] if path.exists() else []
        def command(text):
            os.write(fd, ('\x1b[200~' + text + '\x1b[201~').encode())
            time.sleep(0.15)
            os.write(fd, b'\r')
        child_pids = []
        try:
            wait(lambda: re.search(rb'Prototype root: ([^\r\n]+)', output))
            root = Path(re.search(rb'Prototype root: ([^\r\n]+)', output)[1].decode())
            wait(lambda: len(events('ready')) == 1)
            child_pids = [item['pid'] for item in events('start')]
            assert len(events('quit-adapter-installed')) == 1
            command('/quit')
            wait(lambda: len(events('quit-choice-open')) == 1 and b'Leave temporarily' in output and b'End session' in output)
            assert status is None and not events('shutdown')
            os.write(fd, b'\x1b')
            wait(lambda: events('quit-choice') == ['cancel'])
            assert status is None and not events('shutdown')
            command('Probe $alpha')
            wait(lambda: len(events('settled')) == 1)
            assert not events('quit-choice-error')
            command('/quit')
            wait(lambda: len(events('quit-choice-open')) == 2)
            time.sleep(0.15)
            if choice == 'End session':
                os.write(fd, b'\x1b[B')
                time.sleep(0.1)
            os.write(fd, b'\r')
            wait(lambda: status is not None)
            assert os.waitstatus_to_exitcode(status) == 0
            assert not root.exists()
            records = [json.loads(line) for line in report.read_text().splitlines()]
            assert [item['data'] for item in records if item['type'] == 'quit-choice'] == ['cancel', choice]
            assert [item['data'] for item in records if item['type'] == 'shutdown'] == ['quit']
            assert not [item for item in records if item['type'] == 'quit-choice-error']
            if host in ['combined', 'reverse']:
                assert 'ALPHA_BODY' in json.dumps([item for item in records if item['type'] == 'request'])
            for child_pid in child_pids:
                try:
                    os.kill(child_pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    raise AssertionError(f'Live child: {child_pid}')
            results.append({'host':host,'mode':mode,'choice':choice,'cancelKeepsSession':True,'normalPromptAfterCancel':True,'recordedChoice':choice,'shutdownReason':'quit','cleanExit':True,'launcherPid':pid,'cliPids':child_pids,'rootRemoved':True})
            print(json.dumps(results[-1]), flush=True)
        finally:
            if status is None:
                os.killpg(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            os.close(fd)
            (repo / '.tmp/subagent-cleanup/quit-smoke-last.ansi').write_bytes(output)
(repo / 'adventure/evidence/subagent-quit-prototype-results.json').write_text(json.dumps(results, indent=2)+'\n')
