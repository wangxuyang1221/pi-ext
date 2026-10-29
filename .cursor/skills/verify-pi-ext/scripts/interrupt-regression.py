#!/usr/bin/env python3
"""Regress outer SIGTERM cleanup through the real shared verification entrypoint."""
import argparse, errno, json, os, pty, select, signal, sys, time
from pathlib import Path
repo = Path(__file__).resolve().parents[4]
os.chdir(repo)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", default=f".tmp/test-results/shared-interrupt-{time.time_ns()}")
parser.add_argument("--case", choices=["codex-search", "fast-managed"], default="codex-search")
options = parser.parse_args()
out = (repo / options.output).resolve()
assert out.is_relative_to(repo), "Regression output must remain in the repository"
assert not (repo / ".tmp/verify-pi-ext.lock").exists(), "Shared verification is already running"
out.mkdir(parents=True, exist_ok=False)
pid,fd=pty.fork()
if pid==0:
    os.execvp('node',['node','.cursor/skills/verify-pi-ext/scripts/verify.mjs',
                      'run' if options.case == 'fast-managed' else 'tui', options.case])
raw=bytearray(); summary_path=None; status=None; observed=[]
def pump():
    global status
    if select.select([fd],[],[],.1)[0]:
        try: raw.extend(os.read(fd,65536))
        except OSError as e:
            if e.errno!=errno.EIO: raise
    if status is None:
        done,result=os.waitpid(pid,os.WNOHANG)
        if done: status=result
try:
    deadline=time.monotonic()+80
    while time.monotonic()<deadline:
        pump()
        for line in raw.decode(errors='replace').splitlines():
            if line.startswith('{"case":') and '"evidence"' in line:
                try: summary_path=Path(json.loads(line)['evidence'])/'summary.json'
                except (ValueError,KeyError): pass
        if summary_path and summary_path.exists():
            summary=json.loads(summary_path.read_text()); scratch=Path(summary['scratch'])
            events=scratch/'events.jsonl'
            if options.case == 'fast-managed':
                starts = list((scratch / 'home').glob('start-*.json'))
                if any(json.loads(path.read_text()).get('parent') for path in starts): break
            elif events.exists() and any(json.loads(line).get('type') == 'ready' for line in events.read_text().splitlines()): break
        if status is not None: raise AssertionError('outer process exited before ready')
    else: raise AssertionError('ready timeout')
    import subprocess
    rows=subprocess.check_output(['ps','-axo','pid=,ppid=']).decode().splitlines()
    pairs=[tuple(map(int,r.split())) for r in rows if len(r.split())==2]
    owned={pid}; changed=True
    while changed:
        new={p for p,pp in pairs if pp in owned}; changed=bool(new-owned); owned|=new
    if options.case == 'fast-managed':
        owned.update(int(path.stem.split('-')[1]) for path in starts)
        server = subprocess.check_output([str(scratch/'tmux'), 'display-message', '-p', '#{pid}']).decode().strip()
        owned.add(int(server))
    observed=sorted(owned)
    (out/'before.json').write_text(json.dumps({'pids':observed,'evidence':str(summary_path.parent)},indent=2))
    os.kill(pid,signal.SIGTERM)
    deadline=time.monotonic()+25
    while status is None and time.monotonic()<deadline: pump()
    assert status is not None,'outer exit timeout'
    summary=json.loads(summary_path.read_text())
    checks={'cleanupRemoved':summary.get('cleanup')=='removed','journeyExists':(summary_path.parent/'journey.json').exists(),'ansiExists':(summary_path.parent/'terminal.ansi').exists(),'lockAbsent':not (repo/'.tmp/verify-pi-ext.lock').exists(),'scratchAbsent':not Path(summary['scratch']).exists()}
    alive=[]
    for p in observed:
        try: os.kill(p,0); alive.append(p)
        except ProcessLookupError: pass
    checks['processesStopped']=not alive
    if options.case == 'fast-managed':
        managed = json.loads((summary_path.parent/'managed.json').read_text())
        checks['managedStopped'] = not managed['livePids'] and managed['socketUnavailable']
    result={'checks':checks,'alive':alive,'summary':summary}
    (out/'result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({"checks": checks, "evidence": str(summary_path.parent), "regression": str(out)}))
    assert all(checks.values()),checks
finally:
    for p in reversed(observed):
        try: os.kill(p,signal.SIGTERM)
        except ProcessLookupError: pass
    os.close(fd)
    deadline=time.monotonic()+4
    while status is None and time.monotonic()<deadline:
        done,result=os.waitpid(pid,os.WNOHANG)
        if done: status=result
        else: time.sleep(.05)
    for p in reversed(observed):
        try: os.kill(p,signal.SIGKILL)
        except ProcessLookupError: pass
    if status is None:
        os.kill(pid,signal.SIGKILL); os.waitpid(pid,0)
    (out/'outer.ansi').write_bytes(raw)
