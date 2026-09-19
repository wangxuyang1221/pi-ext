"""Resource and artifact isolation checks for the development evaluator."""

from pathlib import Path
import os
import socket
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import codex_compact_quality_environment as environment
sys.path.pop(0)


class EnvironmentRunnerTests(unittest.TestCase):
    def test_successful_parent_does_not_leave_a_listening_child(self):
        self.assertTrue(callable(getattr(environment, "run_test_process", None)))
        temporary_root = ROOT / ".tmp/codex-quality/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as folder:
            folder = Path(folder)
            port_file = folder / "port"
            child = "import socket,time,pathlib; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); " \
                    f"pathlib.Path({str(port_file)!r}).write_text(str(s.getsockname()[1])); time.sleep(30)"
            parent = "import subprocess,sys,time,pathlib; " \
                     f"subprocess.Popen([sys.executable,'-c',{child!r}]); p=pathlib.Path({str(port_file)!r}); " \
                     "deadline=time.monotonic()+5\nwhile not p.exists() and time.monotonic()<deadline: time.sleep(.01)\n" \
                     "raise SystemExit(0 if p.exists() else 1)"
            result = environment.run_test_process([sys.executable, "-c", parent], cwd=folder,
                                                  env=dict(os.environ), log=folder / "stdout.log", timeout=10)
            self.assertEqual(result["returncode"], 0)
            self.assertFalse(result["timed_out"])
            with socket.socket() as client:
                self.assertNotEqual(client.connect_ex(("127.0.0.1", int(port_file.read_text()))), 0)

    def test_timeout_is_recorded_and_existing_log_is_not_overwritten(self):
        temporary_root = ROOT / ".tmp/codex-quality/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as folder:
            folder = Path(folder)
            log = folder / "stdout.log"
            result = environment.run_test_process([sys.executable, "-c", "import time; time.sleep(30)"],
                                                  cwd=folder, env=dict(os.environ), log=log, timeout=0.1)
            self.assertTrue(result["timed_out"])
            self.assertLess(result["returncode"], 0)
            self.assertLess(result["seconds"], 4)
            with self.assertRaises(FileExistsError):
                environment.run_test_process([sys.executable, "-c", "print('replacement')"],
                                             cwd=folder, env=dict(os.environ), log=log, timeout=1)
            self.assertEqual(log.read_text(), "")

    def test_outside_paths_and_symlink_escapes_are_rejected(self):
        temporary_root = ROOT / ".tmp/codex-quality/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as folder:
            folder = Path(folder)
            (folder / "escape").symlink_to(ROOT.parent, target_is_directory=True)
            with self.assertRaises(ValueError):
                environment.contained(ROOT, folder / "escape")
            with self.assertRaises(ValueError):
                environment.contained(ROOT, ROOT.parent)
            self.assertEqual(environment.contained(ROOT, folder / "safe"), folder / "safe")


if __name__ == "__main__":
    unittest.main()
