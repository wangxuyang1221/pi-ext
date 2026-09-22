"""Exercise real Pi rendering and capture its terminal cells for visual review."""
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
from PIL import Image, ImageDraw, ImageFont

here = Path(__file__).resolve().parent
repo = here.parents[2]
mode = 'fullscreen' if '--fullscreen' in sys.argv else 'regular'
before = '--before' in sys.argv
style = 'before' if before else 'after'
output_dir = repo / '.tmp' / f'subagent-ui-{style}-{mode}'
output_dir.mkdir(parents=True, exist_ok=True)
screen = pyte.Screen(120, 70)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder('utf-8')('replace')
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLORTERM'] = 'truecolor'
    os.execvp('node', ['node', str(here / 'demo.mjs'), *sys.argv[1:]])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 70, 120, 0, 0))
status = None
output = bytearray()
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
        output.extend(data)
        stream.feed(decoder.decode(data))
    if status is None:
        found, value = os.waitpid(pid, os.WNOHANG)
        if found:
            status = value

def wait(predicate, label, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()
        if predicate():
            return
        if status is not None:
            break
    raise AssertionError(f'{label}\n{view()}')

def settle(seconds=0.5):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()

def command(text):
    os.write(fd, text.encode() + b'\r')

def markers():
    values = []
    for row, text in enumerate(screen.display):
        if text.lstrip().startswith(('⏺', '•', '├─ ⏺')):
            column = text.index('⏺') if '⏺' in text else text.index('•')
            values.append(screen.buffer[row][column].fg)
    return values

font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 18)
bold_font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 18, index=1)
marker_font = ImageFont.truetype('/System/Library/Fonts/Supplemental/STIXTwoMath.otf', 18)
symbol_font = ImageFont.truetype('/System/Library/Fonts/Apple Symbols.ttf', 18)
cell_w, cell_h = 11, 26

def color(value, fallback):
    return '#' + value if len(value) == 6 else fallback

def capture(name):
    screens[name] = view()
    rows = [i for i, line in enumerate(screen.display) if line.strip()]
    start = next((i for i in reversed(rows) if screen.display[i].strip().startswith(('Before:', 'After:'))), 0)
    end = rows[-1] + 1 if rows else screen.lines
    image = Image.new('RGB', (screen.columns * cell_w + 32, (end - start) * cell_h + 32), '#171717')
    draw = ImageDraw.Draw(image)
    for row in range(start, end):
        for col in range(screen.columns):
            char = screen.buffer[row][col]
            x, y = 16 + col * cell_w, 16 + (row - start) * cell_h
            fg, bg = color(char.fg, '#d6d6d6'), color(char.bg, '#171717')
            if char.reverse:
                fg, bg = bg, fg
            if bg != '#171717':
                draw.rectangle((x, y, x + cell_w, y + cell_h), fill=bg)
            if char.data.strip():
                face = marker_font if char.data == '⏺' else symbol_font if char.data == '⎿' else bold_font if char.bold else font
                draw.text((x, y), char.data, font=face, fill=fg)
    image.save(output_dir / f'{name}.png')

def demo(kind, outcome):
    command(f'/demo {kind} {outcome} {style}')
    wait(lambda: f'Comparison ready: {style} / {kind} / {outcome}.' in view(), f'{kind}/{outcome}')
    settle()

try:
    wait(lambda: f'Comparison ready: {style} / all / success.' in view(), 'initial fixtures')
    settle()
    assert 'Extension issues' not in view(), view()
    for text in ['Spawned Lin', 'Sent input to Lin', 'Listed 2 subagents', 'Read activity from Lin', 'Finished waiting for Lin', 'Closed Lin', 'Read tool-style.ts', 'Bash']:
        assert text in view(), (text, view())
    assert markers()[-6:] == (['77777d'] * 6 if before else ['4dff88'] * 6), markers()
    capture('success')
    os.write(fd, b'\x0f')
    settle()
    assert 'Reviewed the renderer.' in view(), view()
    if not before:
        assert '│ Review subagent' in view(), view()
    capture('expanded')
    os.write(fd, b'\x0f')
    settle()
    command(f'/demo all hold {style}')
    wait(lambda: 'Waiting for child-lin' in view() and 'Closing child-lin' in view(), 'all six held')
    settle()
    assert markers()[-6:] == (['77777d'] * 6 if before else ['ffe66d'] * 6), markers()
    capture('running')
    command('/finish success')
    wait(lambda: f'Comparison ready: {style} / all / hold.' in view(), 'held calls complete')
    settle()
    assert markers()[-6:] == (['77777d'] * 6 if before else ['4dff88'] * 6), markers()
    demo('all', 'error')
    assert 'Spawn failed' in view(), view()
    assert markers()[-6:] == (['77777d'] * 6 if before else ['ff6b6b'] * 6), markers()
    capture('error')
    for outcome in ['timeout', 'interrupted']:
        demo('wait', outcome)
        assert markers()[-1:] == (['77777d'] if before else ['ffe66d']), markers()
        capture(outcome)
    command(f'/demo spawn success {style} long')
    wait(lambda: f'Comparison ready: {style} / spawn / success.' in view(), 'long agent name')
    for width in [80, 40, 120]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 70, width, 0, 0))
        screen.resize(70, width)
        settle(0.7)
        assert 'Spawned' in view(), view()
        capture(f'width-{width}')
    command('/quit')
    wait(lambda: status is not None, 'shutdown')
    assert os.waitstatus_to_exitcode(status) == 0, status
    (output_dir / 'screens.json').write_text(json.dumps(screens, ensure_ascii=False, indent=2))
    print(json.dumps({'passed': True, 'style': style, 'mode': mode, 'screens': len(screens), 'directory': str(output_dir)}))
finally:
    (output_dir / 'terminal.ansi').write_bytes(output)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 5
        while status is None and time.monotonic() < deadline:
            pump()
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
