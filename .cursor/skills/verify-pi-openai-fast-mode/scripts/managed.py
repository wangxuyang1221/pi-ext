"""Verify real managed Fast inheritance using existing dist and a private tmux."""
import json
import os
from pathlib import Path
import runpy
import shlex
import shutil
import signal
import subprocess
import sys
import time

repo = Path(__file__).resolve().parents[4]
root, evidence = map(Path, sys.argv[1:])
shared = repo / '.cursor/skills/verify-pi-ext/scripts'
home = root / 'home'
agent = root / 'agent'
tmux = shutil.which('tmux')
node = shutil.which('node')
assert tmux and node and shutil.which('fish'), 'Node, tmux and fish are required'
quote = shlex.quote
wrapper = root / 'tmux'
pi = root / 'pi'
# A relative socket path avoids the macOS sockaddr_un length limit.
wrapper.write_text('#!/bin/sh\ncd ' + quote(str(agent)) + ' || exit 90\nexec ' + quote(tmux) + ' -S managed.sock -f /dev/null "$@"\n')
cli = repo / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
provider = repo / 'extensions/subagent/__tests__/fixtures/fast-provider.ts'
fast = repo / 'extensions/openai-fast-mode/dist/index.js'
pi.write_text('#!/bin/sh\nexec ' + ' '.join(map(quote, [node, str(cli), '--offline', '--no-extensions', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-builtin-tools', '--no-approve', '-e', str(provider), '-e', str(fast)])) + ' "$@"\n')
wrapper.chmod(0o700)
pi.chmod(0o700)
recipe = {
    'extensions': ['subagent', '.cursor/skills/verify-pi-ext/scripts/command-provider.ts'],
    'provider': str(provider.relative_to(repo)), 'providerName': 'openai-codex', 'model': 'fast-fixture',
    'env': {'PI_SUBAGENT_TMUX_PATH': str(wrapper), 'PI_SUBAGENT_PI_PATH': str(pi)},
}
recipe_path = evidence / 'recipe.json'
recipe_path.write_text(json.dumps(recipe, indent=2))
report = {'passed': False, 'children': [], 'pids': [], 'boundary': 'Real root TUI and managed child; offline HTTP responses; no installation or build'}
owned = set()

def tm(*args):
    return subprocess.run([str(wrapper), *args], capture_output=True, text=True, timeout=10)

def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False

def child_rows(marker):
    found = []
    for path in home.glob('payload-*.jsonl'):
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        if rows and rows[0]['text'].startswith('[subagent:') and marker in rows[0]['text']:
            found.append((int(path.stem.split('-')[1]), rows))
    return found

def journey(c):
    for index, enabled in enumerate([True, False], 1):
        marker = 'MANAGED_FAST_' + ('ON' if enabled else 'OFF')
        c['send']('/fast ' + ('on' if enabled else 'off'))
        config = agent / 'extensions/pi-openai-fast-mode/config.json'
        c['wait'](lambda: json.loads(config.read_text()).get('enabled') is enabled, 'root-fast-saved-' + marker)
        c['send']('spawn:' + json.dumps({'task': marker}))
        c['wait'](lambda: len(child_rows(marker)) == 1, 'child-first-request-' + marker)
        pid, rows = child_rows(marker)[0]
        owned.add(pid)
        server = tm('display-message', '-p', '#{pid}')
        assert server.returncode == 0, server.stderr
        owned.add(int(server.stdout.strip()))
        start = json.loads((home / f'start-{pid}.json').read_text())
        launch = json.loads(start['launch'])
        assert start.get('parent'), 'Child must be spawned by the production manager'
        assert launch['fast'] is enabled, 'Managed launch must inherit the root switch'
        assert rows[0]['payload'].get('service_tier') == ('priority' if enabled else None), 'First child request must match inherited Fast'
        c['wait'](lambda: c['condition']({'eventType': 'settled', 'eventCount': index}), 'root-settled-' + marker)
        root_rows = [json.loads(line) for line in (home / f"payload-{c['pid']}.jsonl").read_text().splitlines()]
        root_request = next(row for row in root_rows if marker in row['text'])
        assert root_request['payload'].get('service_tier') == ('priority' if enabled else None), 'Root request must match the saved Fast switch'
        report['children'].append({'pid': pid, 'enabled': enabled, 'launch': launch, 'rootRequest': root_request, 'firstRequest': rows[0], 'sessionId': start['sessionId']})
    assert (agent / 'managed.sock').is_socket(), 'Archive regression needs a live socket'
    c['drive']([{'capture': {'path': 'agent', 'as': 'managed-agent'}}, {'capture': {'path': 'home', 'as': 'managed-home'}},
                {'send': '/quit'}, {'wait': {'screenIncludes': 'End session'}}, {'keys': ['enter']}, {'wait': {'processExited': True}}])
    assert (evidence / 'managed-agent/settings.json').read_bytes() == (agent / 'settings.json').read_bytes(), 'Regular configuration must survive socket archival'
    assert not (evidence / 'managed-agent/managed.sock').exists(), 'Sockets must not be archived'
    assert str(agent / 'managed.sock') in c['archive_skipped'], 'Skipped socket must be recorded'
    c['wait'](lambda: not any(alive(item['pid']) for item in report['children']), 'end-session-stops-children')
    report['endSessionStoppedChildren'] = True

try:
    sys.argv = [str(shared / 'commands.py'), 'journey:openai-fast-mode', str(root), str(evidence), str(recipe_path)]
    runpy.run_path(str(shared / 'commands.py'), init_globals={'drive_custom': journey}, run_name='__main__')
    report['passed'] = True
finally:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    for path in home.glob('start-*.json'):
        owned.add(int(path.stem.split('-')[1]))
    server = tm('display-message', '-p', '#{pid}')
    if server.returncode == 0:
        owned.add(int(server.stdout.strip()))
    tm('kill-server')
    deadline = time.monotonic() + 5
    while any(alive(pid) for pid in owned) and time.monotonic() < deadline:
        time.sleep(0.05)
    report['pids'] = sorted(owned)
    report['livePids'] = [pid for pid in owned if alive(pid)]
    report['socketUnavailable'] = tm('list-sessions').returncode != 0
    report['passed'] = report['passed'] and not report['livePids'] and report['socketUnavailable']
    (evidence / 'managed.json').write_text(json.dumps(report, indent=2))
    assert not report['livePids'] and report['socketUnavailable'], 'Owned managed processes must stop'
