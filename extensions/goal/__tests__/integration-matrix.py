"""Re-run pinned goal acceptance fixtures in repository-local isolated environments."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

repo = Path(__file__).resolve().parents[3]
root = Path(sys.argv[1]).resolve()
assert root.is_relative_to(repo), "Evidence must stay inside the repository"
root.mkdir(parents=True, exist_ok=True)
assert not (root / "matrix.json").exists(), "Use a fresh evidence directory"
command_mode = len(sys.argv) > 2 and sys.argv[2] == "--"
packages = [] if command_mode else [Path(value).resolve() for value in sys.argv[2:]]
rows = []
observed = {}
(root / "runner.pid").write_text(str(os.getpid()))


def descendants(pid):
    listing = subprocess.check_output(["ps", "-axo", "pid=,ppid=,command="], text=True)
    table = {}
    for line in listing.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) == 3:
            table[int(fields[0])] = (int(fields[1]), fields[2])
    selected = {pid}
    for _ in range(12):
        selected |= {child for child, (parent, _) in table.items() if parent in selected}
    return {child: table[child][1] for child in selected if child in table}


def run(name, command, extra=None, timeout=150):
    case = root / name
    case.mkdir()
    for directory in ("home", "tmp", "agent", "sessions"):
        (case / directory).mkdir()
    env = {key: os.environ[key] for key in ("PATH", "LANG") if key in os.environ}
    env.update({"HOME": str(case / "home"), "TMPDIR": str(case / "tmp"),
                "PI_CODING_AGENT_DIR": str(case / "agent"),
                "PI_CODING_AGENT_SESSION_DIR": str(case / "sessions"),
                "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "SHELL": "/bin/sh",
                "TERM": "xterm-256color", "XDG_CACHE_HOME": str(case / "home" / ".cache")})
    env.update(extra or {})
    started = time.monotonic()
    with (case / "run.log").open("wb") as log:
        process = subprocess.Popen(command, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        observed[process.pid] = " ".join(command)
        try:
            while process.poll() is None:
                observed.update(descendants(process.pid))
                (root / "processes.json").write_text(json.dumps(observed, indent=2))
                if time.monotonic() - started > timeout:
                    raise TimeoutError(name)
                time.sleep(0.1)
        except BaseException:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
    row = {"name": name, "command": command, "pid": process.pid, "exitCode": process.returncode,
           "seconds": round(time.monotonic() - started, 2), "log": str(case / "run.log"), "environment": env}
    rows.append(row)
    (root / "matrix.json").write_text(json.dumps(rows, indent=2))
    print(f"{name}: exit {process.returncode}", flush=True)
    assert process.returncode == 0, f"Acceptance failed: {name}; see {case / 'run.log'}"


if command_mode:
    run("command", sys.argv[3:], timeout=600)

for package in packages:
    version = json.loads((package / "package.json").read_text())["version"].replace(".", "")
    for fixture in ("runtime", "lifecycle-runtime", "processes", "execution-runtime", "budget-runtime", "content-runtime"):
        name = f"{version}-{fixture}"
        evidence = str(root / name / "evidence")
        run(name, ["node", f"extensions/goal/__tests__/{fixture}.mjs", str(package)],
            {"GOAL_BUDGET_EVIDENCE": evidence, "GOAL_CONTENT_EVIDENCE": evidence})
    for scenario in ("retry-c12", "stream-interrupt", "stream-pause", "tool-interrupt", "edit-cancel", "replace-cancel", "c11", "retry-dialog", "input-steer", "input-followup", "compact-success", "compact-failure", "compact-cancel", "compact-manual"):
        name = f"{version}-tui-{scenario}"
        run(name, [sys.executable, "extensions/goal/__tests__/acceptance-tui-driver.py", str(root / name / "evidence"), str(package)], {"GOAL_TUI_SCENARIO": scenario})
    for scenario in ("soft", "baseline", "quota", "interrupt"):
        name = f"{version}-budget-tui-{scenario}"
        run(name, [sys.executable, "extensions/goal/__tests__/budget-tui-driver.py", str(root / name / "evidence"), str(package)], {"GOAL_BUDGET_SCENARIO": scenario})
    for codex in ("0", "1"):
        name = f"{version}-content-tui-ui{codex}"
        run(name, [sys.executable, "extensions/goal/__tests__/content-tui-driver.py", str(root / name / "evidence"), str(package)], {"GOAL_UI_CODEX": codex})
    for scenario in ("budget", "duplicate", "late", "pending"):
        name = f"{version}-tmux-{scenario}"
        run(name, ["node", "extensions/goal/__tests__/child-tmux-runtime.mjs", str(package)],
            {"GOAL_CHILD_SCENARIO": scenario, "GOAL_CHILD_EVIDENCE": str(root / name / "evidence")})

print(f"Passed {len(rows)} fresh acceptance executions", flush=True)
