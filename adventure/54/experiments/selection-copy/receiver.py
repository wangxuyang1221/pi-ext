"""Receive only an exact authorized sample without echoing pasted content."""
import os
from pathlib import Path
import sys
import termios
import tty


def receive(expected):
    captured = bytearray()
    while True:
        byte = os.read(sys.stdin.fileno(), 1)
        if byte == b'\x03':
            return None
        if byte in (b'', b'\x04'):
            return bytes(captured)
        if len(captured) <= len(expected):
            captured.extend(byte)


def main():
    expected_file, output_file = map(Path, sys.argv[1:])
    expected = expected_file.read_bytes()
    descriptor = sys.stdin.fileno()
    previous = termios.tcgetattr(descriptor)
    try:
        tty.setraw(descriptor)
        print('\x1b[?2004lCAPTURE READY: paste, then Ctrl+D; Ctrl+C cancels.', flush=True)
        captured = receive(expected)
    finally:
        termios.tcflush(descriptor, termios.TCIFLUSH)
        termios.tcsetattr(descriptor, termios.TCSANOW, previous)
    if captured is None:
        print('CAPTURE CANCELLED')
        return 2
    if captured != expected:
        print('CAPTURE REJECTED: sample mismatch; nothing saved.')
        return 1
    with output_file.open('xb') as output:
        output.write(captured)
    print('CAPTURE MATCH: authorized sample saved.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
