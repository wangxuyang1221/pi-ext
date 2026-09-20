"""Capture the real Pi PTY cell grid; rasterize without reconstructing UI layout."""
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
import unicodedata
import pyte
from PIL import Image, ImageDraw, ImageFont

config = json.loads(Path(sys.argv[1]).read_text())
root = Path(config["root"])
output = Path(config["output"])
columns, rows = 104, 30
pid, fd = pty.fork()
if pid == 0:
    os.chdir(config["cwd"])
    os.execvpe(config["command"][0], config["command"], config["env"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
screen = pyte.Screen(columns, rows)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder("utf-8")()
status = None
shots = {}
raw_output = bytearray()

def events(kind):
    file = root / "events.jsonl"
    if not file.exists():
        return []
    return [item["data"] for line in file.read_text().splitlines() if (item := json.loads(line))["kind"] == kind]

def pump():
    global status
    ready, _, _ = select.select([fd], [], [], 0.03)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        raw_output.extend(data)
        stream.feed(decoder.decode(data))
    if status is None:
        done, value = os.waitpid(pid, os.WNOHANG)
        if done:
            status = value

def settle(seconds=0.35):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        pump()

def wait(predicate, label):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        pump()
        if predicate():
            settle()
            return
        if status is not None:
            break
    raise AssertionError(label + "\n" + "\n".join(screen.display))

def send(value):
    os.write(fd, value.encode())
    settle()

def paste(value):
    send("\x1b[200~" + value + "\x1b[201~")

def grid():
    return [[dict(screen.buffer[y][x]._asdict()) for x in range(columns)] for y in range(rows)]

def grab(name):
    shots[name] = {"cells": grid(), "text": screen.display[:], "cursor": [screen.cursor.x, screen.cursor.y]}

def editor():
    before = len(events("editor"))
    send("\x1b[17~")
    wait(lambda: len(events("editor")) > before, "editor observer")
    return events("editor")[-1]

def color(value, fallback):
    aliases = {"black": "000000", "red": "cd3131", "green": "0dbc79", "brown": "e5e510", "blue": "2472c8", "magenta": "bc3fbc", "cyan": "11a8cd", "white": "e5e5e5"}
    value = aliases.get(value, value)
    return "#" + value if len(value) == 6 else fallback

def raster(shot, file):
    cw, ch, margin = 13, 30, 18
    image = Image.new("RGB", (columns * cw + margin * 2, rows * ch + margin * 2), "#27282b")
    draw = ImageDraw.Draw(image)
    ascii_font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 21)
    cjk_paths = list(Path("/System/Library/AssetsV2").glob("**/PingFang.ttc"))
    cjk_font = ImageFont.truetype(str(cjk_paths[0]), 24) if cjk_paths else ascii_font
    for y, row in enumerate(shot["cells"]):
        for x, cell in enumerate(row):
            bg = color(cell["bg"], "#27282b")
            fg = color(cell["fg"], "#e5e5e5")
            if cell["reverse"]:
                fg, bg = bg, fg
            draw.rectangle((margin+x*cw, margin+y*ch, margin+(x+1)*cw-1, margin+(y+1)*ch-1), fill=bg)
    for y, row in enumerate(shot["cells"]):
        for x, cell in enumerate(row):
            char = cell["data"]
            if not char or char == " ":
                continue
            fg = color(cell["bg"], "#27282b") if cell["reverse"] else color(cell["fg"], "#e5e5e5")
            wide = unicodedata.east_asian_width(char[0]) in ["W", "F"]
            font = cjk_font if wide else ascii_font
            px, py = margin+x*cw, margin+y*ch+3
            draw.text((px, py), char, font=font, fill=fg, stroke_width=0)
            if cell["bold"]:
                draw.text((px+0.45, py), char, font=font, fill=fg)
            if cell["underscore"]:
                draw.line((px, py+25, px+cw*(2 if wide else 1), py+25), fill=fg)
    x, y = shot["cursor"]
    draw.line((margin+x*cw, margin+y*ch+2, margin+x*cw, margin+(y+1)*ch-2), fill="#eeeeee", width=2)
    image.save(file)

try:
    wait(lambda: events("ready"), "CLI startup")
    settle(1)
    assert events("ready")[-1]["tty"]
    original = editor()
    assert "$presentations," in original and "$lark-doc，" in original
    grab("input")
    assert any(cell["fg"] == "89cdff" for row in shots["input"]["cells"] for cell in row), "Input decoration missing"
    send("\r")
    wait(lambda: events("settled"), "offline submit")
    request = events("request")[-1]
    user = [message for message in request if message["role"] == "user"][-1]
    content = user["content"]
    text = content if isinstance(content, str) else "\n".join(block["text"] for block in content if block["type"] == "text")
    snapshot = json.loads(text.split("\n")[1])
    assert snapshot["task"] == original
    assert [item["name"] for item in snapshot["skills"]] == ["presentations", "lark-doc"]
    assert "\x1b" not in text, "Visual ANSI leaked into model input"
    paste(original)
    grab("both")
    text_rows = [i for i, row in enumerate(screen.display) if "$presentations," in row]
    assert len(text_rows) == 2, "Must show both user and editor references\n" + "\n".join(screen.display)
    for y in text_rows:
        x = screen.display[y].index("$presentations,")
        assert screen.buffer[y][x].fg == "89cdff", (y, x, screen.buffer[y][x])
        if config["variant"] == "tint":
            assert screen.buffer[y][x].bg == "2b3e4e", screen.buffer[y][x]
    y = text_rows[0]
    assert screen.buffer[y][0].bg == screen.buffer[y][columns - 1].bg == "434343", "User row background must remain intact"
    assert screen.buffer[y][screen.display[y].index(",")].bg == "434343", "Mention background must not leak"
    assert "[skill]" in "\n".join(screen.display), "Native cards missing"
    # Keep source edits and completion under the real editor.
    send("\x03")
    paste("用 $pre")
    send("s")
    wait(lambda: "PowerPoint" in "\n".join(screen.display), "Native skill menu")
    before = len(events("request"))
    send("\t")
    assert editor() == "用 $presentations"
    assert len(events("request")) == before
    grab("menu-selected")
    send("\x03")
    paste("$presentations,")
    assert editor() == "$presentations,"
    grab("punctuation")
    assert "PowerPoint" not in "\n".join(screen.display), "Punctuation must not open completion"
    send("\x03")
    ready_before = len(events("ready"))
    alternate = "accent" if config["variant"] == "tint" else "tint"
    send(f"/prototype {alternate}\r")
    wait(lambda: len(events("ready")) > ready_before, "public reload style switch")
    assert events("ready")[-1]["variant"] == alternate
    paste(original)
    assert editor() == original
    grab("switched")
    assert any(cell["fg"] == "89cdff" for row in shots["switched"]["cells"] for cell in row)
    send("\x03")
    send("/quit\r")
    wait(lambda: status is not None, "graceful quit")
    assert os.waitstatus_to_exitcode(status) == 0
    stem = f"skill-ui-{config['variant']}{'-native' if config['native'] else ''}"
    for name in ["input", "both"]:
        raster(shots[name], output / f"{stem}-{name}.png")
    summary = {"variant": config["variant"], "native": config["native"], "pid": pid, "exit": 0, "checks": ["real CLI PTY", "input and user colors", "native cards", "original task and two snapshots", "no ANSI in provider input", "Tab completion does not send", "punctuation does not open menu", "public reload style switch"], "screens": {name: shot["text"] for name, shot in shots.items()}}
    (output / f"{stem}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"passed": True, "variant": config["variant"], "pid": pid, "exit": 0}))
finally:
    if sys.exc_info()[0]:
        (output / "skill-ui-debug.ansi").write_bytes(raw_output)
    if status is None:
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 5
        while status is None and time.monotonic() < deadline:
            pump()
        if status is None:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    os.close(fd)
