"""Drive an isolated stock Pi terminal and archive the observed journey."""
import codecs
import errno
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
import tarfile
import tempfile
import termios
import time
import traceback

import pyte

from live_event_records import read_records


def interrupt_owned_driver(signum, _frame):
    raise KeyboardInterrupt(f'Owned driver interrupted by signal {signum}')


class PtyJourney:
    def __init__(self, repo, mode, case_name, preflight):
        if mode not in ('regular', 'fullscreen'):
            raise ValueError(f'Unknown terminal mode: {mode}')
        self.preflight = preflight
        self.mode = mode
        self.evidence = repo / '.tmp/test-results' / f'{case_name}-{mode}-{time.time_ns()}'
        self.evidence.mkdir(parents=True)
        self.root = Path(tempfile.mkdtemp(prefix='scratch-', dir=self.evidence))
        for name in ('home', 'agent', 'workspace', 'sessions', 'tmp', 'cache', 'config', 'data', 'state'):
            (self.root / name).mkdir()
        self.env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL', 'TZ') if key in os.environ}
        self.env.update(
            HOME=str(self.root / 'home'), TMPDIR=str(self.root / 'tmp'),
            PI_CODING_AGENT_DIR=str(self.root / 'agent'), AUDIT_ROOT=str(self.root),
            TERM='xterm-256color', COLORTERM='truecolor', PI_OFFLINE='1',
            PI_SKIP_VERSION_CHECK='1', PYTHONDONTWRITEBYTECODE='1',
        )
        for kind in ('cache', 'config', 'data', 'state'):
            self.env[f'XDG_{kind.upper()}_HOME'] = str(self.root / kind)
        self.actions = []
        self.snapshots = {}
        self.assertions = []
        self.processes = []
        self.install_records = []
        self.pid, self.fd, self.status = None, None, None
        self.raw = bytearray()
        for owned_signal in (signal.SIGTERM, signal.SIGHUP):
            signal.signal(owned_signal, interrupt_owned_driver)

    def install(self, host, package):
        preflight = self.preflight(self.evidence, 'install')
        tarball = self.root / 'plugin.tgz'
        pack = subprocess.run(
            ['pnpm', 'pack', '--json', '--out', str(tarball)], cwd=package,
            env={**self.env, 'pnpm_config_ignore_scripts': 'true', 'pnpm_config_verify_deps_before_run': 'false'},
            capture_output=True, timeout=30,
        )
        (self.evidence / 'pack.stdout').write_bytes(pack.stdout)
        (self.evidence / 'pack.stderr').write_bytes(pack.stderr)
        self.check(pack.returncode == 0 and tarball.is_file(), 'pnpm packs the selected built plugin')
        with tarfile.open(tarball) as archive:
            archive.extractall(self.root / 'installed', filter='data')
        installed_package = self.root / 'installed/package'

        args = [*host, 'install', str(installed_package)]
        result = subprocess.run(args, cwd=self.root / 'workspace', env=self.env, capture_output=True, timeout=30)
        (self.evidence / 'install.stdout').write_bytes(result.stdout)
        (self.evidence / 'install.stderr').write_bytes(result.stderr)
        self.install_records.append({'command': args, 'exitCode': result.returncode, 'doctor': preflight})
        self.check(result.returncode == 0, 'Pi installs the selected local package')
        agent = self.root / 'agent'
        settings = json.loads((agent / 'settings.json').read_text())
        installed_paths = [(agent / entry).resolve() for entry in settings.get('packages', [])]
        self.check(installed_paths == [installed_package], 'Only the selected UI package is installed')
        return installed_package

    def records(self, *, final=False):
        return read_records(self.root / 'events.jsonl', final=final)

    def check(self, condition, message):
        self.assertions.append({'assertion': message, 'passed': bool(condition)})
        if not condition:
            raise AssertionError(message)

    def start(self, extra=None):
        preflight = self.preflight(self.evidence, str(len(self.processes) + 1))
        args = [*self.cli, '--tui-mode', self.mode, *(extra or [])]
        before = len(self.records())
        self.raw = bytearray()
        self.status = None
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(self.root / 'workspace')
            os.execvpe(args[0], args, self.env)

        self.processes.append({'pid': self.pid, 'command': args, 'doctor': preflight})
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 60, 140, 0, 0))
        self.screen = pyte.Screen(140, 60)
        self.stream = pyte.Stream(self.screen)
        self.decoder = codecs.getincrementaldecoder('utf8')('replace')
        self.wait(lambda: any(event['type'] == 'themes' for event in self.records()[before:]), 'ready')
        self.settle(.5)
        self.snap(f'startup-{len(self.processes)}')

    def view(self):
        return '\n'.join(row.rstrip() for row in self.screen.display)

    def snap(self, label):
        rows = []
        for y in range(self.screen.lines):
            runs = []
            for x in range(self.screen.columns):
                cell = self.screen.buffer[y][x]
                style = [cell.fg, cell.bg, cell.italics]
                if runs and runs[-1][2:] == style:
                    runs[-1][1] = x + 1
                else:
                    runs.append([x, x + 1, *style])
            rows.append(runs)
        self.snapshots[label] = {
            'text': self.view(), 'size': [self.screen.columns, self.screen.lines],
            'rawOffset': len(self.raw), 'process': len(self.processes), 'styleRuns': rows,
        }

    def pump(self):
        if select.select([self.fd], [], [], .04)[0]:
            try:
                data = os.read(self.fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b''
            self.raw.extend(data)
            if b'\x1b[6n' in data:
                os.write(self.fd, b'\x1b[1;1R')
            self.stream.feed(self.decoder.decode(data))
        if self.status is None:
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.status = status

    def settle(self, seconds=.35):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.pump()

    def wait(self, predicate, label, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.pump()
            if predicate():
                self.snap(label)
                return
            if self.status is not None:
                break
        self.snap(f'failed-{label}')
        raise AssertionError(f'Failed: {label}\n{self.view()}')

    def keys(self, data, label):
        self.actions.append({'action': label, 'bytes': data.hex(), 'at': time.monotonic(), 'rawOffset': len(self.raw)})
        os.write(self.fd, data)

    def command(self, text):
        self.keys(b'\x15' + text.encode() + b'\r', text)

    def titles(self, data=None):
        return re.findall(rb'\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)', self.raw if data is None else data)

    def request(self, label, plan):
        (self.root / 'plan.json').write_text(json.dumps(plan))
        self.actions.append({'seed': plan, 'label': label})
        before = len(self.records())
        self.command(label)
        self.wait(lambda: any(event['type'] == 'agent_settled' for event in self.records()[before:]), f'{label} settled')
        self.settle()
        self.snap(label)
        return [event['data'] for event in self.records() if event['type'] == 'tool_execution_end']

    def reload(self):
        before = len(self.records())
        self.command('/reload')
        self.wait(lambda: any(event['type'] == 'session_start' for event in self.records()[before:]), 'reloaded')
        self.settle()

    def save_keybindings(self, bindings):
        (self.root / 'agent/keybindings.json').write_text(json.dumps(bindings))
        self.actions.append({'keybindingsSeed': bindings})

    def save_settings(self, settings):
        (self.root / 'agent/settings.json').write_text(json.dumps(settings))
        self.actions.append({'settingsSeed': settings})

    def resize(self, width, height=60):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', height, width, 0, 0))
        self.screen.resize(height, width)
        os.kill(self.pid, signal.SIGWINCH)
        self.settle()
        self.actions.append({'resize': [width, height]})

    def archive_process(self):
        (self.evidence / f'terminal-{len(self.processes)}.ansi').write_bytes(self.raw)
        os.close(self.fd)
        self.fd = None
        process = self.processes[-1]
        try:
            os.kill(self.pid, 0)
            process['stopped'] = False
        except ProcessLookupError:
            process['stopped'] = True
        try:
            os.killpg(self.pid, 0)
            process['groupStopped'] = False
        except ProcessLookupError:
            process['groupStopped'] = True
        return process

    def stop(self):
        if self.status is None:
            self.command('/quit')
            self.wait(lambda: self.status is not None, 'exit')
        process = self.archive_process()
        self.check(os.waitstatus_to_exitcode(self.status) == 0, 'CLI exits normally')
        self.check(process['stopped'], 'Owned PID stopped')
        self.check(process['groupStopped'], 'Owned process group stopped')

    def finish(self, passed):
        if self.fd is not None:
            if self.status is None:
                try:
                    os.killpg(self.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                deadline = time.monotonic() + 5
                while self.status is None and time.monotonic() < deadline:
                    self.pump()
                if self.status is None:
                    os.killpg(self.pid, signal.SIGKILL)
                    _, self.status = os.waitpid(self.pid, 0)
            self.archive_process()

        for name in ('agent', 'sessions', 'workspace'):
            shutil.copytree(self.root / name, self.evidence / name)
        cleanup_safe = all(p.get('stopped') and p.get('groupStopped') for p in self.processes)
        try:
            events = self.records(final=cleanup_safe)
            (self.evidence / 'events.json').write_text(json.dumps(events, ensure_ascii=False, indent=2))
        except ValueError:
            passed = False
            shutil.copyfile(self.root / 'events.jsonl', self.evidence / 'events.jsonl')
            failure = traceback.format_exc()
            (self.evidence / 'event-archive-failure.txt').write_text(failure)
            print(failure)
        if cleanup_safe:
            shutil.rmtree(self.root)
        else:
            passed = False
        summary = {
            'passed': passed, 'mode': self.mode, 'installs': self.install_records, 'scratch': str(self.root),
            'scratchRemoved': not self.root.exists(), 'processes': self.processes, 'actions': self.actions,
            'assertions': self.assertions, 'screens': self.snapshots,
            'layer': 'native CLI/PTy; offline model boundary; real tools/files/session',
        }
        (self.evidence / 'journey.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps({'passed': passed, 'evidence': str(self.evidence)}))
        return passed
