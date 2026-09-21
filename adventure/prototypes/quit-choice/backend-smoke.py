"""Exercise the real subagent plugin and isolated tmux from the real Pi TUI."""
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
import sys

repo = Path(__file__).resolve().parents[3]
results = []
scenarios = sys.argv[1:] or ['empty', 'leave', 'end-running', 'query-retry', 'partial-close-retry', 'cancel', 'main-busy', 'reload', 'resume']
for scenario in scenarios:
    unselected = scenario in ['sighup-resume', 'sigterm-resume', 'sigkill-resume', 'ctrld-resume']
    report = repo / f'.tmp/subagent-cleanup/backend-{scenario}.jsonl'
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.environ['QUIT_PROBE_REPORT'] = str(report)
        os.execvp('node', ['node', 'adventure/prototypes/quit-choice/run.mjs', 'combined', 'regular', 'unselected-resume' if unselected else 'resume' if scenario == 'resume' else 'real'])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    output, status, root = bytearray(), None, None
    def events(kind):
        path = root / 'events.jsonl'
        return [row['data'] for line in path.read_text().splitlines() if (row := json.loads(line))['type'] == kind] if path.exists() else []
    def wait(predicate):
        global status
        deadline = time.monotonic() + 40
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
        raise AssertionError(f'{scenario}: '+output.decode(errors='replace')[-7000:])
    def command(text):
        os.write(fd, ('\x1b[200~'+text+'\x1b[201~').encode())
        time.sleep(0.15)
        os.write(fd, b'\r')
    def alive(target):
        try:
            os.kill(target, 0)
            return True
        except ProcessLookupError:
            return False
    try:
        wait(lambda: re.search(rb'Prototype root: ([^\r\n]+)', output))
        root = Path(re.search(rb'Prototype root: ([^\r\n]+)', output)[1].decode())
        wait(lambda: len(events('quit-adapter-installed')) == 1 and len(events('ready')) == 1)
        if scenario == 'resume' or unselected:
            command('Persist root session')
            wait(lambda: len(events('settled')) == 1)
        if scenario != 'empty':
            command('/probe-spawn hold:work' if scenario == 'end-running' else '/probe-spawn fast work')
            wait(lambda: len(events('probe-spawn')) == 1 or events('probe-spawn-error'))
            assert not events('probe-spawn-error'), events('probe-spawn-error')
            if scenario == 'end-running':
                wait(lambda: (root / 'home/started-work').exists())
            if scenario == 'partial-close-retry':
                command('/probe-spawn second work')
                wait(lambda: len(events('probe-spawn')) == 2 or events('probe-spawn-error'))
                assert not events('probe-spawn-error'), events('probe-spawn-error')
                (root / 'fail-close').write_text(events('probe-spawn')[1]['tmux']['windowId'])
        if scenario == 'reload':
            command('/reload')
            wait(lambda: len(events('quit-adapter-installed')) == 2 and len(events('ready')) == 2)
        if scenario == 'main-busy':
            command('QUEUE_HOLD')
            wait(lambda: bool(events('request')))
            assert not events('settled')
        if scenario == 'query-retry':
            (root / 'fail-query').write_text('fail')
        if unselected:
            original = events('start')[0]
            child_pid = events('probe-spawn')[0]['tmux']['panePid']
            if scenario == 'ctrld-resume':
                os.write(fd, b'\x04')
            else:
                os.kill(original['pid'], {'sighup-resume': signal.SIGHUP, 'sigterm-resume': signal.SIGTERM, 'sigkill-resume': signal.SIGKILL}[scenario])
            wait(lambda: len(events('start')) == 2 and len(events('ready')) == 2)
            assert not alive(original['pid']) and alive(child_pid)
            assert events('start')[1]['session'] == original['session']
            assert not events('quit-choice') and not events('quit-cleaned')
        command('/quit')
        if scenario == 'empty':
            wait(lambda: status is not None)
        elif scenario == 'query-retry':
            wait(lambda: bool(events('quit-choice-error')))
            assert status is None and not events('shutdown') and not events('quit-choice-open')
            assert all(alive(row['tmux']['panePid']) for row in events('probe-spawn'))
            (root / 'fail-query').unlink()
            command('/quit')
            wait(lambda: len(events('quit-choice-open')) == 1)
            time.sleep(0.15)
            os.write(fd, b'\r')
            wait(lambda: status is not None)
        else:
            wait(lambda: len(events('quit-choice-open')) == 1)
            time.sleep(0.15)
            if scenario in ['leave', 'resume']:
                os.write(fd, b'\x1b[B')
                time.sleep(0.1)
            elif scenario == 'cancel':
                os.write(fd, b'\x1b')
                wait(lambda: events('quit-choice') == ['cancel'])
                assert status is None and not events('shutdown')
                assert all(alive(row['tmux']['panePid']) for row in events('probe-spawn'))
                command('/quit')
                wait(lambda: len(events('quit-choice-open')) == 2)
                time.sleep(0.15)
            os.write(fd, b'\r')
            if scenario == 'resume':
                wait(lambda: len(events('start')) == 2 and len(events('ready')) == 2)
                starts = events('start')
                assert starts[0]['session'] == starts[1]['session'] and starts[0]['pid'] != starts[1]['pid']
                assert all(alive(row['tmux']['panePid']) for row in events('probe-spawn'))
                command('/quit')
                wait(lambda: len(events('quit-choice-open')) == 2)
                time.sleep(0.15)
                os.write(fd, b'\r')
            if scenario == 'partial-close-retry':
                wait(lambda: bool(events('quit-choice-error')))
                assert status is None and not events('shutdown')
                children = events('probe-spawn')
                wait(lambda: not alive(children[0]['tmux']['panePid']))
                assert alive(children[1]['tmux']['panePid'])
                (root / 'fail-close').unlink()
                command('/quit')
                wait(lambda: len(events('quit-choice-open')) == 2)
                time.sleep(0.15)
                os.write(fd, b'\r')
            wait(lambda: status is not None)
        assert os.waitstatus_to_exitcode(status) == 0, output.decode(errors='replace')[-7000:]
        rows = [json.loads(line) for line in report.read_text().splitlines()]
        values = lambda kind: [row['data'] for row in rows if row['type'] == kind]
        summary = json.loads(Path(str(report)+'.summary.json').read_text())
        cleanup = json.loads(Path(str(report)+'.cleanup.json').read_text())
        assert summary['keeperAlive'], summary
        assert not cleanup['livePids'] and cleanup['socketUnavailable']
        assert not root.exists()
        expected_shutdowns = ['reload', 'quit'] if scenario == 'reload' else ['quit', 'quit'] if scenario == 'resume' or unselected and scenario != 'sigkill-resume' else ['quit']
        assert values('shutdown') == expected_shutdowns, values('shutdown')
        if unselected:
            assert values('quit-choice') == ['End session']
            assert values('quit-status')[0]['capacity']['active'] == 1
            assert len(values('start')) == 2
            if scenario == 'sigkill-resume':
                assert values('probe-process-exit')[0]['signal'] == 'SIGKILL'
        if scenario == 'resume':
            assert values('quit-choice') == ['Leave temporarily', 'End session']
            assert values('quit-status')[-1]['capacity']['active'] == 1
        if scenario == 'main-busy':
            assert len(values('quit-root-abort')) == 1
            assert rows.index(next(row for row in rows if row['type'] == 'quit-root-abort')) < rows.index(next(row for row in rows if row['type'] == 'settled'))
        if scenario == 'empty':
            assert not values('quit-choice-open') and len(values('quit-without-choice')) == 1
        elif scenario == 'leave':
            assert values('quit-choice') == ['Leave temporarily']
            assert all(row['alive'] for row in summary['agents']), summary
            assert not values('quit-cleaned')
        else:
            assert values('quit-choice')[-1] == 'End session'
            assert not any(row['alive'] for row in summary['agents']), summary
            assert values('quit-cleaned')[-1]['capacity']['active'] == 0
        assert not alive(pid)
        assert all(not alive(row['pid']) for row in values('start'))
        for child_pid in cleanup['pids']:
            assert not alive(child_pid), child_pid
        results.append({'scenario':scenario,'passed':True,'mainPids':[row['pid'] for row in values('start')],'unselectedResume':unselected,'observedShutdownEvents':values('shutdown'),'beforeLauncherCleanup':summary,'cleanup':cleanup,'launcherPid':pid})
        print(json.dumps(results[-1]), flush=True)
    finally:
        if status is None:
            os.killpg(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
            # Only the isolated probe socket may be cleaned up here.
            if root and (root / 'tmux').exists():
                import subprocess
                subprocess.run([str(root / 'tmux'), 'kill-server'], capture_output=True)
        os.close(fd)
        (repo / f'.tmp/subagent-cleanup/backend-{scenario}.ansi').write_bytes(output)
result_file = repo / 'adventure/evidence/subagent-quit-backend-results.json'
previous = json.loads(result_file.read_text()) if result_file.exists() else []
merged = [row for row in previous if row['scenario'] not in scenarios] + results
result_file.write_text(json.dumps(merged, indent=2)+'\n')
