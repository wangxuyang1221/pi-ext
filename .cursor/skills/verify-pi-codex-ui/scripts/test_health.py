"""Check preflight failure evidence and refusal before an app can be driven."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from health import doctor


class DoctorTest(unittest.TestCase):
    def run_doctor(self, result):
        root = Path(self.temp.name)
        with patch("health.subprocess.run", return_value=result) as run:
            name = doctor(root, root, "test")
            command = run.call_args
            self.assertEqual(command.args[0], ["node", str(root / ".cursor/skills/verify-pi-ext/scripts/verify.mjs"), "doctor"])
            self.assertEqual(command.kwargs["cwd"], root)
            self.assertEqual(command.kwargs["env"]["pnpm_config_verify_deps_before_run"], "false")
            self.assertTrue(command.kwargs["capture_output"])
            self.assertTrue(command.kwargs["text"])
            return name

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[4] / ".tmp")
        self.addCleanup(self.temp.cleanup)

    def test_success_retains_the_real_doctor_result(self):
        output = '{"lockPresent":false,"revision":"fixture"}'
        name = self.run_doctor(subprocess.CompletedProcess([], 0, output, "diagnostic"))
        self.assertEqual(name, "doctor-test.json")
        self.assertEqual((Path(self.temp.name) / name).read_text(), output)
        self.assertEqual((Path(self.temp.name) / "doctor-test.stderr").read_text(), "diagnostic")

    def test_nonzero_doctor_preserves_evidence_and_refuses_drive(self):
        with self.assertRaisesRegex(RuntimeError, "exit 7"):
            self.run_doctor(subprocess.CompletedProcess([], 7, "partial", "failed"))
        self.assertEqual((Path(self.temp.name) / "doctor-test.json").read_text(), "partial")
        self.assertEqual((Path(self.temp.name) / "doctor-test.stderr").read_text(), "failed")

    def test_occupied_lock_refuses_drive(self):
        with self.assertRaisesRegex(RuntimeError, "lock is occupied"):
            self.run_doctor(subprocess.CompletedProcess([], 0, '{"lockPresent":true}', ""))

    def test_malformed_doctor_is_not_healthy(self):
        with self.assertRaises(json.JSONDecodeError):
            self.run_doctor(subprocess.CompletedProcess([], 0, "not json", ""))

    def test_missing_lock_status_is_not_healthy(self):
        with self.assertRaises(KeyError):
            self.run_doctor(subprocess.CompletedProcess([], 0, "{}", ""))

    def test_nonboolean_lock_status_is_not_healthy(self):
        for value in [None, 0, "", [], {}]:
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "status is invalid"):
                self.run_doctor(subprocess.CompletedProcess([], 0, json.dumps({"lockPresent": value}), ""))


if __name__ == "__main__":
    unittest.main()
