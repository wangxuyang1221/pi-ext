"""Fail-closed checks for executable continuation grading."""

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "scripts" / "codex_compact_quality_grader.py"


def load_module():
    if not MODULE.exists():
        return None
    spec = importlib.util.spec_from_file_location("quality_grader", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


grader = load_module()


class ExecutableGraderTests(unittest.TestCase):
    def test_exit_zero_does_not_hide_missing_or_skipped_required_tests(self):
        self.assertTrue(callable(getattr(grader, "grade_junit", None)))
        xml = '<testsuites><testsuite><testcase classname="tests.test_task" name="test_a"/>' \
              '<testcase classname="tests.test_task" name="test_b"><skipped/></testcase></testsuite></testsuites>'
        result = grader.grade_junit(xml, ["tests/test_task.py::test_a", "tests/test_task.py::test_b", "tests/test_task.py::test_c"], returncode=0)
        self.assertFalse(result["passed"])
        self.assertEqual(result["tests"], {"tests/test_task.py::test_a": "passed",
                                           "tests/test_task.py::test_b": "skipped",
                                           "tests/test_task.py::test_c": "missing"})

    def test_errors_duplicates_and_nonzero_exit_cannot_pass(self):
        required = ["tests/test_task.py::TestTask::test_value[a::b]"]
        case = '<testcase classname="tests.test_task.TestTask" name="test_value[a::b]"/>'
        xml = f'<testsuite>{case}</testsuite>'
        self.assertTrue(grader.grade_junit(xml, required, returncode=0)["passed"])
        self.assertFalse(grader.grade_junit(xml, required, returncode=1)["passed"])
        self.assertFalse(grader.grade_junit(xml, required, returncode=False)["passed"])
        duplicate = grader.grade_junit(f'<testsuite>{case}{case}</testsuite>', required, returncode=0)
        self.assertEqual(duplicate["tests"][required[0]], "duplicate")
        self.assertFalse(duplicate["passed"])
        self.assertFalse(grader.grade_junit('<invalid/>', required, returncode=0)["passed"])
        self.assertFalse(grader.grade_junit('truncated <xml', required, returncode=0)["passed"])
        error = case.replace('/>', '><error/></testcase>')
        self.assertEqual(grader.grade_junit(f'<testsuite>{error}</testsuite>', required, returncode=1)["tests"][required[0]], "failed")

    def test_a_suite_level_error_cannot_hide_behind_passing_testcases(self):
        required = ["tests/test_task.py::test_a"]
        xml = '<testsuite><error message="teardown failed"/><testcase classname="tests.test_task" name="test_a"/></testsuite>'
        self.assertFalse(grader.grade_junit(xml, required, returncode=0)["passed"])


class ScopeGraderTests(unittest.TestCase):
    def test_scope_failures_include_added_removed_and_changed_files(self):
        self.assertTrue(callable(getattr(grader, "grade_scope", None)))
        before = {"src/fix.py": "before", "tests/test_fix.py": "trusted", "lockfile": "locked"}
        after = {"src/fix.py": "after", "tests/test_fix.py": "tampered", "answer.txt": "new"}
        result = grader.grade_scope(before, after, allowed_paths=["src/fix.py"])
        self.assertFalse(result["passed"])
        self.assertEqual(result["violations"], ["answer.txt", "lockfile", "tests/test_fix.py"])
        self.assertTrue(grader.grade_scope(before, {**before, "src/fix.py": "after"}, allowed_paths=["src/fix.py"])["passed"])


class EvidenceGraderTests(unittest.TestCase):
    def test_old_answers_omissions_and_invented_certainty_are_failures(self):
        self.assertTrue(callable(getattr(grader, "grade_evidence", None)))
        sources = {"u1": "The active schema is v3, not v2. The rollout date is unknown.",
                   "u2": "Do not edit tests."}
        checks = [
            {"id": "schema", "expected": "v3", "category": "correction", "critical": True,
             "evidence": [{"source_id": "u1", "quote": "active schema is v3, not v2", "retention": "not_retained"}]},
            {"id": "rollout", "expected": None, "category": "uncertainty", "critical": True,
             "evidence": [{"source_id": "u1", "quote": "rollout date is unknown", "retention": "uncertain"}]},
            {"id": "restriction", "expected": "tests", "category": "constraint", "critical": True,
             "evidence": [{"source_id": "u2", "quote": "Do not edit tests.", "retention": "retained"}]},
        ]
        result = grader.grade_evidence({"schema": "v2", "rollout": "tomorrow"}, checks, sources)
        self.assertFalse(result["critical_passed"])
        self.assertEqual([r["status"] for r in result["checks"]], ["incorrect", "incorrect", "missing"])
        self.assertEqual(result["checkpoint_only"], {"passed": 0, "total": 1})
        correct = grader.grade_evidence({"schema": "v3", "rollout": None, "restriction": "tests"}, checks, sources)
        self.assertTrue(correct["critical_passed"])
        self.assertEqual(correct["checkpoint_only"], {"passed": 1, "total": 1})
        with self.assertRaises(ValueError):
            grader.grade_evidence({}, checks, {"u1": "A different source.", "u2": sources["u2"]})


class SessionGraderTests(unittest.TestCase):
    def test_success_requires_the_task_and_every_required_constraint(self):
        self.assertTrue(callable(getattr(grader, "grade_session", None)))
        kwargs = {"executable": {"passed": True}, "scope": {"passed": True},
                  "evidence": {"critical_passed": True}, "reached_endpoint": True,
                  "required_constraints": ["no_network"], "observations": {"no_network": True}}
        self.assertTrue(grader.grade_session(**kwargs)["automated_success"])
        for field, value in (("scope", {"passed": False}), ("executable", {"passed": False}),
                             ("evidence", {"critical_passed": False}), ("reached_endpoint", False),
                             ("observations", {}), ("observations", {"no_network": "true"})):
            self.assertFalse(grader.grade_session(**{**kwargs, field: value})["automated_success"], field)
        self.assertEqual(grader.grade_session(**kwargs)["human_review"], "pending")


if __name__ == "__main__":
    unittest.main()
