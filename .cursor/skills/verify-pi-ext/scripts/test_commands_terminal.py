"""Exercise the interactive driver through an outer terminal and real Pi process."""
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import tempfile
import termios
import time
import unittest
import ast
import codecs
import errno
import tty
from types import SimpleNamespace
from unittest.mock import patch
import pyte

REPO = Path.cwd()
DRIVER = REPO / '.cursor/skills/verify-pi-ext/scripts/commands.py'


class TerminalRelayTests(unittest.TestCase):
    def setUp(self):
        # Load the I/O functions without executing the CLI's startup side effects.
        functions = [node for node in ast.parse(DRIVER.read_text()).body
                     if isinstance(node, ast.FunctionDef) and node.name in
                     {'forward_input', 'relay_output', 'view', 'pump'}]
        self.state = dict(os=os, sys=sys, select=select, errno=errno, time=time,
                          raw=bytearray(), actions=[], snapshots={}, status=None,
                          forward_terminal_input=False, pid=123)
        self.state['screen'] = pyte.Screen(60, 30)
        self.state['stream'] = pyte.Stream(self.state['screen'])
        self.state['decoder'] = codecs.getincrementaldecoder('utf-8')('replace')
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(DRIVER), 'exec'), self.state)
        self.master, self.slave = pty.openpty()
        self.addCleanup(os.close, self.master)
        self.addCleanup(os.close, self.slave)
        tty.setraw(self.slave)
        self.state['fd'] = self.master
        self.input_read, self.input_write = os.pipe()
        self.addCleanup(os.close, self.input_read)
        self.addCleanup(os.close, self.input_write)
        self.output_read, self.output_write = os.pipe()
        self.addCleanup(os.close, self.output_read)
        self.addCleanup(os.close, self.output_write)
        self.state['sys'] = SimpleNamespace(
            stdin=SimpleNamespace(fileno=lambda: self.input_read),
            stdout=SimpleNamespace(fileno=lambda: self.output_write))

    def read_available(self, fd):
        self.assertTrue(select.select([fd], [], [], .2)[0], 'Expected terminal bytes')
        return os.read(fd, 1024)

    def test_input_forwarding_and_empty_poll(self):
        started = time.monotonic()
        self.state['forward_input']()
        self.assertLess(time.monotonic() - started, .1, 'Idle input polling must not stall rendering')
        self.assertEqual(self.state['actions'], [])
        sample = b'\x1b[?1;2c/sample\r'
        os.write(self.input_write, sample)
        self.state['forward_input']()
        self.assertEqual(self.read_available(self.slave), sample)
        self.assertEqual(self.state['actions'][0]['bytes'], sample.hex())

    def test_input_eof_is_reported(self):
        with patch.object(os, 'read', return_value=b''), patch.object(select, 'select', return_value=([self.input_read], [], [])):
            with self.assertRaises(EOFError):
                self.state['forward_input']()

    def test_cursor_reply_is_synthetic_only_for_headless(self):
        for interactive in [False, True]:
            with self.subTest(interactive=interactive):
                self.state['interactive'] = interactive
                output = b'visible\x1b[6n'
                os.write(self.slave, output)
                self.state['relay_output']()
                ready = select.select([self.slave], [], [], .01)[0]
                self.assertEqual(bool(ready), not interactive)
                if ready:
                    self.assertEqual(self.read_available(self.slave), b'\x1b[1;1R')
                if interactive:
                    self.assertEqual(self.read_available(self.output_read), output)
                else:
                    self.assertFalse(select.select([self.output_read], [], [], 0)[0])

    def test_pty_eio_is_eof_but_other_io_errors_propagate(self):
        self.state['interactive'] = False
        for code in [errno.EIO, errno.EBADF]:
            with patch.object(select, 'select', return_value=([self.master], [], [])), patch.object(os, 'read', side_effect=OSError(code, 'test')):
                if code == errno.EIO:
                    self.state['relay_output']()
                else:
                    with self.assertRaises(OSError):
                        self.state['relay_output']()

    def test_process_exit_stops_input_forwarding(self):
        self.state.update(interactive=True, forward_terminal_input=True)
        os.write(self.input_write, b'late input')
        with patch.object(os, 'waitpid', return_value=(123, 0)):
            self.state['pump']()
        self.assertEqual(self.state['status'], 0)
        self.assertEqual(self.state['actions'], [])
        self.assertFalse(select.select([self.slave], [], [], 0)[0])


class InteractiveTerminalTests(unittest.TestCase):
    def exercise(self, mode='regular', interrupt=False, fail_ready=False):
        with tempfile.TemporaryDirectory(prefix='terminal-driver-', dir=REPO / '.tmp') as run:
            root = Path(run)
            scratch, evidence = root / 'scratch', root / 'evidence'
            for name in ['scratch', 'evidence', 'scratch/home', 'scratch/agent', 'scratch/tmp']:
                (root / name).mkdir(parents=True, exist_ok=True)
            recipe = root / 'recipe.json'
            settings = {'rows': 30, 'columns': 60, 'cliArgs': ['--tui-mode', mode]}
            if fail_ready:
                settings.update(ready={'eventType': 'never-ready'}, timeoutSeconds=1)
            recipe.write_text(json.dumps(settings))
            env = dict(PATH=os.environ['PATH'], LANG='en_US.UTF-8', TERM='xterm-256color',
                       HOME=str(scratch / 'home'), PI_CODING_AGENT_DIR=str(scratch / 'agent'),
                       TMPDIR=str(scratch / 'tmp'), PI_OFFLINE='1', PI_SKIP_VERSION_CHECK='1',
                       PI_TELEMETRY='0', NODE_COMPILE_CACHE=str(scratch / 'cache'))
            master, slave = pty.openpty()
            previous = termios.tcgetattr(slave)
            python = [sys.executable]
            if os.environ.get('TERMINAL_TEST_COVERAGE'):
                python.extend(['-m', 'coverage', 'run', '--parallel-mode',
                               '--data-file', str(REPO / '.tmp/shared-terminal-66/.coverage')])
            child = subprocess.Popen([*python, str(DRIVER), 'explore:codex-ui',
                                      str(scratch), str(evidence), str(recipe)],
                                     cwd=REPO, env=env, stdin=slave, stdout=slave, stderr=slave,
                                     start_new_session=True)
            raw = bytearray()
            sent_reply = False
            startup_flags = None
            quit_sent = False
            try:
                deadline = time.monotonic() + 25
                while child.poll() is None and time.monotonic() < deadline:
                    if select.select([master], [], [], .05)[0]:
                        chunk = os.read(master, 65536)
                        raw.extend(chunk)
                        if not sent_reply and b'\x1b[c' in raw:
                            startup_flags = termios.tcgetattr(slave)[3]
                            os.write(master, b'\x1b[?1;2c')
                            sent_reply = True
                            if interrupt:
                                child.send_signal(signal.SIGTERM)
                    events = scratch / 'events.jsonl'
                    ready = events.exists() and any(json.loads(line).get('type') == 'ready'
                                                    for line in events.read_text().splitlines())
                    if ready and sent_reply and not interrupt and not fail_ready and not quit_sent:
                        os.write(master, b'/quit\r')
                        quit_sent = True
                self.assertIsNotNone(child.poll(), 'Driver did not exit')
                while select.select([master], [], [], .05)[0]:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        break
                    raw.extend(chunk)
                self.assertTrue(sent_reply, 'Real Pi must issue its startup capability query')
                journey = json.loads((evidence / 'journey.json').read_text())
                self.assertTrue(journey['processStopped'])
                self.assertEqual(journey['cleanupErrors'], [])
                restored = termios.tcgetattr(slave)
                restored[3] &= ~termios.PENDIN
                previous[3] &= ~termios.PENDIN
                self.assertEqual(restored, previous, 'Outer terminal settings must be restored')
                if interrupt or fail_ready:
                    self.assertNotEqual(child.returncode, 0)
                    self.assertFalse(journey['completed'])
                else:
                    self.assertEqual(child.returncode, 0)
                    self.assertTrue(journey['completed'])
                self.assertFalse(startup_flags & termios.ECHO, 'Startup replies must not echo before ready')
                self.assertFalse(startup_flags & termios.ICANON, 'Startup replies must reach Pi without Enter')
                self.assertNotIn(b'^[[?1;2c', raw, 'Capability reply was rendered as literal terminal text')
                if not interrupt:
                    inputs = b''.join(bytes.fromhex(item['bytes']) for item in journey['actions'] if 'bytes' in item)
                    self.assertIn(b'\x1b[?1;2c', inputs, 'Actual terminal reply must be forwarded')
                if record := os.environ.get('TERMINAL_TEST_RECORD'):
                    with open(record, 'a') as output:
                        output.write(json.dumps({'mode': mode, 'interrupt': interrupt,
                                                 'failReady': fail_ready, 'driverPid': child.pid,
                                                 'pids': journey['pids'], 'exitCode': child.returncode,
                                                 'restored': True, 'startupFlags': startup_flags,
                                                 'processStopped': journey['processStopped'],
                                                 'cleanupErrors': journey['cleanupErrors']}) + '\n')
            finally:
                if child.poll() is None:
                    child.send_signal(signal.SIGTERM)
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                owners = evidence / 'owners.json'
                if owners.exists():
                    for pid in json.loads(owners.read_text())['pids']:
                        try:
                            os.killpg(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                os.close(master)
                os.close(slave)

    def test_startup_replies_are_forwarded_without_echo(self):
        for mode in ['regular', 'fullscreen']:
            with self.subTest(mode=mode):
                self.exercise(mode=mode)

    def test_startup_interruption_restores_outer_terminal(self):
        for mode in ['regular', 'fullscreen']:
            with self.subTest(mode=mode):
                self.exercise(mode=mode, interrupt=True)

    def test_readiness_failure_restores_outer_terminal(self):
        for mode in ['regular', 'fullscreen']:
            with self.subTest(mode=mode):
                self.exercise(mode=mode, fail_ready=True)


if __name__ == '__main__':
    unittest.main()
