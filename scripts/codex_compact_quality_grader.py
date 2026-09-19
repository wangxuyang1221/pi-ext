"""Executable-test grading; no model output is used as a reference answer."""

import json
import re
import xml.etree.ElementTree as ET


def _junit_key(nodeid):
    # Match pytest 7.3.1 mangle_test_address, including parameterized names.
    path, bracket, parameters = nodeid.partition("[")
    names = path.split("::")
    if len(names) < 2 or not names[0].endswith(".py"):
        raise ValueError("Expected a complete Python pytest node identifier.")
    names[0] = re.sub(r"\.py$", "", names[0].replace("/", "."))
    names[-1] += bracket + parameters
    return ".".join(names[:-1]), names[-1]


def grade_session(*, executable, scope, evidence, reached_endpoint, required_constraints, observations):
    """Combine automated endpoints without substituting them for human review."""
    if len(set(required_constraints)) != len(required_constraints) or any(not isinstance(c, str) or not c for c in required_constraints):
        raise ValueError("Constraint identifiers must be unique nonempty strings.")
    checks = {"task_completed": executable.get("passed") is True,
              "scope_preserved": scope.get("passed") is True,
              "critical_evidence": evidence.get("critical_passed") is True,
              "endpoint_reached": reached_endpoint is True}
    constraints = {c: observations.get(c) is True for c in required_constraints}
    return {"automated_success": all(checks.values()) and all(constraints.values()),
            "checks": checks, "constraints": constraints, "human_review": "pending"}


def grade_evidence(answer, checks, sources):
    """Grade frozen structured facts against audited source and retention labels.

    Retention labels are evaluator input, not inferred from literal absence.
    Unknown retention is excluded from checkpoint-only scoring. This does not
    inspect or claim to decode an encrypted summary.
    """
    if not isinstance(answer, dict) or not checks:
        raise ValueError("A structured answer and nonempty frozen checks are required.")
    results, seen = [], set()
    for check in checks:
        identity = check.get("id")
        if not isinstance(identity, str) or not identity or identity in seen:
            raise ValueError("Check identifiers must be unique nonempty strings.")
        seen.add(identity)
        if "expected" not in check or type(check.get("critical")) is not bool:
            raise ValueError("Expected values and explicit critical flags are required.")
        category = check.get("category")
        if category not in ("fact", "correction", "reasoning", "constraint", "uncertainty", "task_state"):
            raise ValueError("Unknown evidence category.")
        evidence = check.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError("Each check must cite original evidence.")
        for item in evidence:
            source = sources.get(item.get("source_id"))
            quote = item.get("quote")
            if not isinstance(source, str) or not isinstance(quote, str) or not quote or quote not in source:
                raise ValueError("Evidence quote does not match its original source.")
            if item.get("retention") not in ("retained", "not_retained", "uncertain"):
                raise ValueError("Explicit retention annotations are required.")
        expected = json.dumps(check["expected"], sort_keys=True, allow_nan=False)
        if identity not in answer:
            status = "missing"
        else:
            try:
                actual = json.dumps(answer[identity], sort_keys=True, allow_nan=False)
                status = "passed" if actual == expected else "incorrect"
            except (TypeError, ValueError):
                status = "invalid_answer"
        results.append({"id": identity, "category": category, "critical": check["critical"],
                        "status": status,
                        "checkpoint_only_eligible": all(item["retention"] == "not_retained" for item in evidence)})
    unsupported = sorted(set(answer) - seen)
    independent = [row for row in results if row["checkpoint_only_eligible"]]
    return {"checks": results, "unsupported_fields": unsupported,
            "critical_passed": not unsupported and all(row["status"] == "passed" for row in results if row["critical"]),
            "checkpoint_only": {"passed": sum(row["status"] == "passed" for row in independent), "total": len(independent)}}


def grade_scope(before, after, *, allowed_paths):
    """Compare trusted full-workspace fingerprints, not a model-declared diff."""
    paths = set(before) | set(after) | set(allowed_paths)
    for path in paths:
        if not isinstance(path, str) or not path or path.startswith("/") or "\\" in path or any(part in ("", ".", "..") for part in path.split("/")):
            raise ValueError("Workspace paths must be canonical relative paths.")
    changed = sorted(path for path in set(before) | set(after)
                     if path not in before or path not in after or before[path] != after[path])
    violations = sorted(set(changed) - set(allowed_paths))
    return {"passed": not violations, "changed": changed, "violations": violations}


def grade_junit(xml, required, *, returncode):
    """Require every expected test to pass exactly once, with a successful exit."""
    if not required or len(set(required)) != len(required):
        raise ValueError("Required tests must be nonempty and unique.")
    expected = {_junit_key(nodeid): nodeid for nodeid in required}
    if len(expected) != len(required):
        raise ValueError("Ambiguous JUnit test identifiers.")
    statuses = {nodeid: "missing" for nodeid in required}
    issues = []
    try:
        root = ET.fromstring(xml)
    except (ET.ParseError, TypeError):
        return {"passed": False, "tests": statuses, "issues": ["invalid_xml"], "returncode": returncode}
    if root.tag not in ("testsuite", "testsuites"):
        issues.append("invalid_root")
    for suite in root.iter("testsuite"):
        if suite.find("error") is not None or suite.find("failure") is not None:
            issues.append("suite_error")
    for case in root.iter("testcase"):
        key = (case.get("classname"), case.get("name"))
        nodeid = expected.get(key)
        failure = case.find("failure") is not None or case.find("error") is not None
        if nodeid is None:
            issues.append("unexpected_test")
            continue
        if statuses[nodeid] != "missing":
            statuses[nodeid] = "duplicate"
            issues.append("duplicate_test")
            continue
        statuses[nodeid] = "failed" if failure else "skipped" if case.find("skipped") is not None else "passed"
    passed = type(returncode) is int and returncode == 0 and not issues and all(s == "passed" for s in statuses.values())
    return {"passed": passed, "tests": statuses, "issues": issues, "returncode": returncode}
