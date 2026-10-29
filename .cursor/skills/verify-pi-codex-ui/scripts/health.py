#!/usr/bin/env -S conda run --no-capture-output -n codex-py312 python
"""Retain the shared read-only preflight before each fresh CLI process."""
import json
import os
import subprocess


def doctor(repo, evidence, label):
    command = ["node", str(repo / ".cursor/skills/verify-pi-ext/scripts/verify.mjs"), "doctor"]
    result = subprocess.run(command, cwd=repo, env={**os.environ, "pnpm_config_verify_deps_before_run": "false"}, capture_output=True, text=True)
    name = f"doctor-{label}.json"
    (evidence / name).write_text(result.stdout)
    (evidence / f"doctor-{label}.stderr").write_text(result.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"Doctor failed before {label}: exit {result.returncode}; see {evidence / name}")
    if json.loads(result.stdout)["lockPresent"] is not False:
        raise RuntimeError("Verification lock is occupied or its status is invalid; inspect its owner before driving")
    return name


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("label")
    args = parser.parse_args()
    print(doctor(args.repo, args.evidence, args.label))
