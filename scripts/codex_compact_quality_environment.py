"""Rebuild and verify an isolated development task before comparing models.

Run with the codex-py312 interpreter; --python selects the task's pinned runtime.
All mutable artifacts must remain inside the current repository directory.
"""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import tarfile
import time

from codex_compact_quality_grader import grade_junit


def digest(data):
    return hashlib.sha256(data).hexdigest()


def contained(root, path):
    resolved = Path(path).resolve()
    resolved.relative_to(root)
    return resolved


def run_test_process(command, *, cwd, env, log, timeout):
    """Run in a private process group and stop descendants on every exit path."""
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout < float("inf"):
        raise ValueError("Timeout must be finite and positive.")
    started, timed_out = time.monotonic(), False
    with Path(log).open("x") as stdout:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stdout,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            cleanup_deadline = time.monotonic() + 3
            while True:
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    break
                if time.monotonic() >= cleanup_deadline:
                    raise RuntimeError("Test process group cleanup could not be verified.")
                time.sleep(0.01)
    return {"returncode": process.returncode, "timed_out": timed_out,
            "seconds": time.monotonic() - started}


def validate(args):
    root = Path.cwd().resolve()
    repository, python, issue_path, output = (contained(root, path) for path in
                                            (args.repository, args.python, args.issue, args.output))
    issue = json.loads(issue_path.read_text())
    required = issue["FAIL_TO_PASS"] + issue["PASS_TO_PASS"]
    if not issue["FAIL_TO_PASS"] or not issue["PASS_TO_PASS"] or len(set(required)) != len(required):
        raise ValueError("Disjoint nonempty fail-to-pass and pass-to-pass tests are required.")
    commit = issue["base_commit"]
    actual_commit = subprocess.check_output(["git", "-C", str(repository), "rev-parse", f"{commit}^{{commit}}"], text=True).strip()
    if actual_commit != commit:
        raise ValueError("The exact source commit is required.")
    archive = subprocess.check_output(["git", "-C", str(repository), "archive", commit])
    generated = {}
    for name in args.generated_file:
        source = contained(repository, repository / name)
        if str(source.relative_to(repository)) != name:
            raise ValueError("Generated paths must be canonical repository-relative paths.")
        generated[name] = source.read_bytes()
    license_path = contained(repository, repository / args.license_file)
    output.mkdir(parents=True, exist_ok=False)
    reports = []
    for mode in ("base", "gold", "base", "gold"):
        folder = output / f"{len(reports)}-{mode}"
        workspace = folder / "workspace"
        workspace.mkdir(parents=True)
        (folder / "tmp").mkdir()
        (folder / "home").mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(workspace, filter="data")
        for name, content in generated.items():
            destination = contained(workspace, workspace / name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        subprocess.run(["git", "init", "--quiet", str(workspace)], check=True)
        patches = [issue["test_patch"]] + ([issue["patch"]] if mode == "gold" else [])
        for patch in patches:
            subprocess.run(["git", "apply", "--check", "-"], input=patch, text=True, cwd=workspace, check=True)
            subprocess.run(["git", "apply", "-"], input=patch, text=True, cwd=workspace, check=True)
        xml = folder / "junit.xml"
        env = {**os.environ, "PYTHONPATH": str(workspace), "PYTHONDONTWRITEBYTECODE": "1",
               "PYTHONNOUSERSITE": "1", "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
               "HOME": str(folder / "home"), "TMPDIR": str(folder / "tmp"), "PYTEST_ADDOPTS": ""}
        command = [str(python), "-m", "pytest", "-q", "-o", "addopts=", "-o", "junit_family=xunit2",
                   "-p", "no:cacheprovider", "--basetemp", str(folder / "tmp/pytest"), "--junitxml", str(xml), *required]
        execution = run_test_process(command, cwd=workspace, env=env, log=folder / "stdout.log", timeout=args.timeout)
        grade = grade_junit(xml.read_text() if xml.exists() else "", required, returncode=execution["returncode"])
        report = {"mode": mode, "repeat": len(reports) // 2, "grade": grade, **execution,
                  "command": command, "directory": str(folder.relative_to(root))}
        (folder / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        reports.append(report)
        print(json.dumps({"mode": mode, "repeat": report["repeat"], "passed": grade["passed"], "returncode": execution["returncode"]}), flush=True)
    valid = all(not r["timed_out"] and (r["grade"]["passed"] if r["mode"] == "gold" else
                all(r["grade"]["tests"][node] == "passed" for node in issue["PASS_TO_PASS"]) and
                any(r["grade"]["tests"][node] == "failed" for node in issue["FAIL_TO_PASS"]) and
                r["grade"]["returncode"] == 1 and not r["grade"]["issues"]) for r in reports)
    result = {"instance_id": issue["instance_id"], "commit": commit, "issue_sha256": digest(issue_path.read_bytes()),
              "source_archive_sha256": digest(archive), "generated_sha256": {name: digest(value) for name, value in generated.items()},
              "license_sha256": digest(license_path.read_bytes()), "platform": platform.platform(), "machine": platform.machine(),
              "python": subprocess.check_output([str(python), "--version"], text=True).strip(),
              "pip_freeze": subprocess.check_output([str(python), "-m", "pip", "freeze", "--all"], text=True).splitlines(),
              "installed_distributions": json.loads(subprocess.check_output([str(python), "-m", "pip", "list", "--format=json"], text=True)),
              "conda_explicit": subprocess.check_output(["conda", "list", "--prefix", str(python.parent.parent), "--explicit", "--sha256"], text=True).splitlines(),
              "validator_sha256": digest(Path(__file__).read_bytes()),
              "grader_sha256": digest(Path(__file__).with_name("codex_compact_quality_grader.py").read_bytes()),
              "source_build_note": "Rebuilt development environment; not the original dataset container.",
              "results": reports, "environment_validated": valid}
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    return valid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("repository", "python", "issue", "output", "license-file"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--generated-file", action="append", default=[])
    parser.add_argument("--timeout", type=float, default=90)
    args = parser.parse_args()
    if not 0 < args.timeout < float("inf"):
        parser.error("Timeout must be finite and positive.")
    return 0 if validate(args) else 1


if __name__ == "__main__":
    raise SystemExit(main())
