"""Exercise the real Pi terminal, layout switching and inspector without network access."""
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
before = {p for p in (repo / '.tmp').glob('codemode-ui-*') if p.is_dir()}
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLORTERM'] = 'truecolor'
    os.execvp('node', ['node', str(here.parent / 'demo.mjs'), *sys.argv[1:]])
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

def settle(seconds=0.5):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()

def command(value):
    os.write(fd, value.encode() + b'\r')

try:
    wait(lambda: 'Running' in view() and 'Codemode' in view(), 'real running state')
    screens['running'] = view()
    wait(lambda: 'Playback complete: partial.' in view(), 'initial partial completion')
    settle()
    assert '1 failed' in view(), view()
    assert 'Script completed' in view(), view()
    assert 'Extension issues' not in view(), view()
    screens['hybrid-collapsed'] = view()
    os.write(fd, b'\x0f')
    wait(lambda: 'Calls in start order' in view() or '配置.ts' in view(), 'native expansion')
    settle()
    assert 'false' in view() and 'true' in view(), view()
    screens['hybrid-expanded'] = view()
    os.write(fd, b'\x0f')
    settle()
    for number, name in enumerate(['Compact', 'Call tree', 'Flat stream', 'Inspector', 'Outcome first', 'Hybrid'], 1):
        command(f'/layout {number}')
        wait(lambda: f'Layout {number}: {name}' in view(), f'layout {number}')
        settle()
        assert f'{number} {name}' in view(), view()
        assert 'fixture-test-fail' in view(), view()
        screens[f'layout-{number}'] = view()
    command('/inspect')
    wait(lambda: 'Codemode inspector' in view(), 'inspector')
    os.write(fd, b'\x1b[B')
    settle()
    screens['inspector-calls'] = view()
    os.write(fd, b'\t')
    wait(lambda: '[Script]' in view(), 'script tab')
    assert 'Promise.allSettled' in view(), view()
    screens['inspector-script'] = view()
    os.write(fd, b'\t')
    wait(lambda: '[Output]' in view(), 'output tab')
    screens['inspector-output'] = view()
    os.write(fd, b'\x1b')
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
    command('/play running')
    wait(lambda: 'fixture-hold' in view() or '1 running' in view(), 'held execution')
    settle()
    command('/stop')
    wait(lambda: 'Interrupted' in view(), 'real abort')
    screens['interrupted'] = view()
    settle()
    command('/play error')
    wait(lambda: 'Playback complete: error.' in view(), 'replay after abort')
    assert 'Script failed' in view(), view()
    screens['failed'] = view()
    command('/play running')
    wait(lambda: '1 running' in view(), 'held replay')
    settle()
    command('/finish')
    wait(lambda: 'Playback complete: running.' in view(), 'finish held execution')
    screens['finished'] = view()
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
    (repo / '.tmp' / f'codemode-ui-{suffix}-screens.json').write_text(json.dumps(screens, ensure_ascii=False, indent=2))
after = {p for p in (repo / '.tmp').glob('codemode-ui-*') if p.is_dir()}
assert after == before, after
print('Codemode UI PTY smoke passed: six layouts, expansion, inspector, resize, themes, abort, replay, cleanup.')
