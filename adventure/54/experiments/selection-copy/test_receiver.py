import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import termios
import time
import unittest

ROOT = Path.cwd()

class ReceiverTests(unittest.TestCase):
    def journey(self, payload, expected, status, saved, pipe_output=False):
        with tempfile.TemporaryDirectory(dir=ROOT) as run:
            run = Path(run)
            (run / 'expected').write_bytes(expected)
            master, slave = pty.openpty()
            original = termios.tcgetattr(slave)
            child = subprocess.Popen(['python', '-m', 'coverage', 'run', '--parallel-mode', '--source=' + str(ROOT), str(ROOT / 'receiver.py'), str(run / 'expected'), str(run / 'actual')], stdin=slave, stdout=subprocess.PIPE if pipe_output else slave, stderr=slave)
            readable = child.stdout.fileno() if pipe_output else master
            output = b''
            try:
                deadline = time.monotonic() + 5
                while b'CAPTURE READY' not in output and time.monotonic() < deadline:
                    if select.select([readable], [], [], .1)[0]:
                        output += os.read(readable, 4096)
                self.assertIn(b'CAPTURE READY', output)
                os.write(master, payload)
                child.wait(timeout=5)
                while select.select([readable], [], [], .05)[0]:
                    chunk = os.read(readable, 4096)
                    if not chunk:
                        break
                    output += chunk
                self.assertEqual(child.returncode, status)
                self.assertNotIn(b'PRIVATE-TEST', output)
                self.assertNotIn(b'FIXTURE', output)
                restored = termios.tcgetattr(slave)
                restored[3] &= ~termios.PENDIN
                original[3] &= ~termios.PENDIN
                self.assertEqual(restored, original)
                self.assertEqual((run / 'actual').exists(), saved)
                if saved:
                    self.assertEqual((run / 'actual').read_bytes(), expected)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()
                if child.stdout is not None:
                    child.stdout.close()
                os.close(master)
                os.close(slave)

    def test_exact_FIXTURE_preserves_unicode_spaces_and_linefeeds(self):
        FIXTURE = '  FIXTURE中文\nnext  \n'.encode()
        self.journey(FIXTURE + b'\x04', FIXTURE, 0, True)

    def test_foreign_clipboard_is_not_echoed_or_saved(self):
        self.journey(b'PRIVATE-TEST' * 100 + b'\x04', b'FIXTURE\n', 1, False)

    def test_prefix_is_not_accepted(self):
        self.journey(b'samp\x04', b'FIXTURE', 1, False)

    def test_extra_suffix_is_not_accepted(self):
        self.journey(b'FIXTUREsuffix\x04', b'FIXTURE', 1, False)

    def test_ready_is_visible_before_input_with_redirected_output(self):
        self.journey(b'FIXTURE\x04', b'FIXTURE', 0, True, pipe_output=True)

    def test_cancel_never_saves(self):
        self.journey(b'FIXTURE\x03', b'FIXTURE', 2, False)

if __name__ == '__main__':
    unittest.main()
