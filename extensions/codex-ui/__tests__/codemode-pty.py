"""Production Pi renderer acceptance through a real PTY, with an offline provider."""
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
import termios
import time
import pyte

here = Path(__file__).resolve().parent
repo = here.parents[2]
before = {p for p in (repo / '.tmp').glob('codemode-production-*') if p.is_dir()}
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLORTERM'] = 'truecolor'
    os.execvp('node', ['node', str(here / 'fixtures/codemode-cli.mjs'), '--restart', *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 80, 120, 0, 0))
screen = pyte.Screen(120, 80)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder('utf-8')('replace')
status = None
screens = {}

def view():
    return '\n'.join(line.rstrip() for line in screen.display)

def pump():
    global status
    ready, _, _ = select.select([fd], [], [], 0.04)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b''
        stream.feed(decoder.decode(data))
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value

def wait(predicate, label, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()
        if predicate():
            return
        if status is not None:
            break
    raise AssertionError(f'Failed: {label}\n{view()}')

def settle(seconds=0.4):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()

def command(value):
    os.write(fd, b'\x15' + value.encode() + b'\r')

def inspect():
    command('/inspect')
    wait(lambda: 'Codemode inspector' in view(), 'inspector')
    settle()

try:
    wait(lambda: 'ACCEPTANCE-DONE: partial' in view(), 'initial completion')
    settle()
    assert 'Script completed' in view() and '1 failed' in view(), view()
    assert 'Extension issues' not in view(), view()
    assert 'PAYLOAD-FROM-SCRIPT' in view(), view()
    screens['collapsed'] = view()
    os.write(fd, b'\x0f')
    wait(lambda: 'false;' in view() and 'true;' in view(), 'native diff expansion')
    screens['expanded'] = view()
    os.write(fd, b'\x0f')
    settle()
    inspect()
    os.write(fd, b'\t')
    wait(lambda: '[Script]' in view(), 'script tab')
    settle()
    assert 'Promise.allSettled' in view(), view()
    os.write(fd, b'\t')
    wait(lambda: '[Output]' in view(), 'output tab')
    settle()
    assert 'PAYLOAD-FROM-SCRIPT' in view(), view()
    screens['inspect'] = view()
    os.write(fd, b'\x1b')
    settle()
    command('/fixture-tree cut')
    wait(lambda: 'TREE-CUT' in view(), 'tree cut')
    settle()
    command('/inspect')
    wait(lambda: 'No codemode execution on this branch' in view(), 'no branch leakage')
    command('/fixture-tree back')
    wait(lambda: 'TREE-BACK' in view(), 'tree return')
    settle()
    inspect()
    wait(lambda: 'Raw result unavailable' in view(), 'metadata-only history')
    screens['tree-history'] = view()
    os.write(fd, b'\x1b')
    settle()
    command('/reload')
    wait(lambda: 'Reloaded' in view(), 'reload')
    inspect()
    wait(lambda: 'Raw result unavailable' in view(), 'reload metadata')
    os.write(fd, b'\x1b')
    settle()
    for scenario, expected in [('timeout', 'Timed out'), ('permission', 'Fixture permission denied'), ('nested', 'fixture_outer'), ('mcp', 'LOCAL-MCP-RESULT'), ('error', 'Script failed'), ('many', '19 more calls'), ('hiddenfail', 'HIDDEN-FAILURE-DONE'), ('empty', 'No calls required')]:
        command(f'/play {scenario}')
        wait(lambda: f'ACCEPTANCE-DONE: {scenario}' in view(), scenario)
        settle()
        assert expected in view(), (scenario, view())
        if scenario == 'hiddenfail':
            assert 'Script completed' in view() and '1 failed' in view() and 'missing.txt' in view(), view()
        screens[scenario] = view()
    command('/play running')
    wait(lambda: '1 running' in view(), 'running real bash')
    settle()
    command('/stop')
    wait(lambda: 'Interrupted' in view(), 'real interruption')
    screens['interrupted'] = view()
    settle()
    command('/play success')
    wait(lambda: 'ACCEPTANCE-DONE: success' in view(), 'success after abort')
    command('/lowpower on')
    wait(lambda: 'Low power: on' in view(), 'low power')
    os.write(fd, b'\x0f')
    settle()
    screens['lowpower'] = view()
    command('/lowpower off')
    wait(lambda: 'Low power: off' in view(), 'low power off')
    os.write(fd, b'\x0f')
    settle()
    for width in [40, 80, 120]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 80, width, 0, 0))
        screen.resize(80, width)
        settle()
        assert 'Codemode' in view(), view()
        screens[f'width-{width}'] = view()
    command('/theme light')
    settle()
    screens['light'] = view()
    command('/theme codex-pi')
    settle()
    command('/compact')
    wait(lambda: 'Compacted from' in view(), 'compaction')
    settle()
    inspect()
    wait(lambda: 'Raw result unavailable' in view(), 'compaction cleared live evidence')
    os.write(fd, b'\x1b')
    settle()
    command('/quit')
    wait(lambda: 'PRODUCTION-RESTORED' in view(), 'fresh process resume')
    inspect()
    wait(lambda: 'Raw result unavailable' in view(), 'restart does not fabricate raw output')
    screens['resumed'] = view()
    os.write(fd, b'\x1b')
    settle()
    command('/quit')
    wait(lambda: status is not None, 'clean exit')
    assert os.waitstatus_to_exitcode(status) == 0, status
finally:
    if status is None:
        command('/quit')
        settle(2)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        settle(3)
    if status is None:
        os.killpg(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(fd)
    suffix = 'fullscreen' if '--fullscreen' in sys.argv else 'regular'
    (repo / '.tmp' / f'codemode-production-{suffix}.json').write_text(json.dumps(screens, ensure_ascii=False, indent=2))
after = {p for p in (repo / '.tmp').glob('codemode-production-*') if p.is_dir()}
assert after == before, after
print('Production codemode PTY passed: tree, inspector, states, nested tools, MCP, branch/reload/compact/resume, themes, cleanup.')
