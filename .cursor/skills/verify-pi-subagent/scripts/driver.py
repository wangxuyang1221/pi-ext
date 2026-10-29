import codecs, errno, fcntl, json, os, pty, select, shutil, signal, struct, subprocess, sys, termios, time, traceback
from pathlib import Path
import pyte
repo = Path.cwd()
root = Path(sys.argv[1])
evidence = Path(sys.argv[2])
home = root / 'home'
agent = root / 'agent'
workspace = root / 'workspace'
workspace.mkdir()
(root / 'sessions').mkdir()

def interrupted(signum, _frame):
    raise SystemExit(128 + signum)
signal.signal(signal.SIGTERM, interrupted)
provider = Path(__file__).with_name('provider.ts')
cli = repo / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
extension = Path(__file__).with_name('controller.ts')
quote = lambda s: "'" + str(s).replace("'", '\'"\'"\'') + "'"
tmux_path = shutil.which('tmux')
node = shutil.which('node')
tmux = root / 'tmux'
pi = root / 'pi'
tmux.write_text('#!/bin/sh\ncd ' + quote(root) + ' || exit 90\nif [ -f delay-startup ]; then case "$1" in new-session|new-window) touch startup-entered; while [ -f delay-startup ]; do sleep 0.02; done ;; esac; fi\nif [ -f fail-close ] && [ "$1" = kill-window ]; then echo "Controlled close failure" >&2; exit 77; fi\nif [ -f suppress-confirmation ]; then\n if [ "$1" = capture-pane ]; then exit 0; fi\n if [ "$1" = send-keys ]; then case "$*" in *0d*) chmod 200 "$(cat suppress-confirmation)" ;; esac; fi\nfi\nexec ' + quote(tmux_path) + ' -S socket -f /dev/null "$@"\n')
tmux.chmod(448)
pi.write_text('#!/bin/sh\nexec ' + quote(node) + ' ' + quote(cli) + ' --offline --no-extensions --no-context-files --no-skills --no-prompt-templates --no-themes --no-builtin-tools --no-approve -e ' + quote(provider) + ' "$@"\n')
pi.chmod(448)
(agent / 'settings.json').write_text(json.dumps({'quietStartup': True, 'retry': {'enabled': False}, 'compaction': {'enabled': False}, 'cacheWarming': 'off', 'defaultProjectTrust': 'never'}))
(agent / 'agents').mkdir()
(agent / 'agents/worker.jsonc').write_text('{"model":"audit/role","thinkingLevel":"low"}')
env = dict(os.environ, PI_SUBAGENT_TMUX_PATH=str(tmux), PI_SUBAGENT_PI_PATH=str(pi), PI_SUBAGENT_MAX_ACTIVE='3', TERM='xterm-256color', SHELL='/bin/sh')
actions = []
checks = []
processes = []
children = []
terminals = []
owned = set()
sessions = []
p = None
passed = False

def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False

def tm(*args):
    result = subprocess.run([str(tmux), *args], capture_output=True, text=True, env=env)
    actions.append({'tmux': list(args), 'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    return result

def record(label, condition, data=None):
    checks.append({'label': label, 'passed': bool(condition), 'data': data})
    assert condition, label

class Terminal:

    def __init__(self, session=None, extension_path=None, environment=None):
        self.screen = pyte.Screen(150, 50)
        self.stream = pyte.Stream(self.screen)
        self.decoder = codecs.getincrementaldecoder('utf8')('replace')
        self.raw = bytearray()
        self.status = None
        args = [str(pi), '-e', str(extension_path or extension), '--session-dir', str(root / 'sessions'), '--provider', 'audit', '--model', 'deterministic']
        if session:
            args += ['--session', session]
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(workspace)
            os.execvpe(args[0], args, {**env, **(environment or {})})
        owned.add(self.pid)
        processes.append({'pid': self.pid, 'command': args})
        terminals.append(self)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 150, 0, 0))
        self.wait(lambda: any((r['type'] == 'ready' for r in self.events())), 'root-ready')
        sessions.append(next((r['data'] for r in self.events() if r['type'] == 'session')))

    def events(self):
        f = home / f'events-{self.pid}.jsonl'
        return [json.loads(l) for l in f.read_text().splitlines()] if f.exists() else []

    def view(self):
        return '\n'.join((line.rstrip() for line in self.screen.display))

    def pump(self):
        if select.select([self.fd], [], [], 0.03)[0]:
            try:
                data = os.read(self.fd, 65536)
            except OSError as e:
                if e.errno != errno.EIO:
                    raise
                data = b''
            self.raw.extend(data)
            self.stream.feed(self.decoder.decode(data))
            if b'\x1b[6n' in data:
                os.write(self.fd, b'\x1b[1;1R')
        if self.status is None:
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.status = status

    def wait(self, predicate, label, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.pump()
            if predicate():
                actions.append({'observed': label, 'screen': self.view(), 'pid': self.pid})
                return
            if self.status is not None:
                break
        raise AssertionError(label + '\n' + self.view())

    def send(self, text):
        actions.append({'input': text, 'pid': self.pid})
        data = b'\x1b[200~' + text.encode() + b'\x1b[201~\r'
        for offset in range(0, len(data), 1024):
            os.write(self.fd, data[offset:offset + 1024])
            self.pump()

    def keys(self, data, label):
        actions.append({'keys': label, 'pid': self.pid})
        os.write(self.fd, data)

    def tool(self, name, args, expect_error=False):
        before = sum((e['type'] == 'settled' for e in self.events()))
        count = sum((e['type'] == 'tool' for e in self.events()))
        self.send('AUDIT_TOOL ' + json.dumps({'name': name if name.startswith('audit_') else 'subagent_' + name, 'args': args}, ensure_ascii=False))
        self.wait(lambda: sum((e['type'] == 'settled' for e in self.events())) > before, 'tool-' + name, 60)
        results = [e['data'] for e in self.events() if e['type'] == 'tool']
        record('tool-result-' + name, len(results) == count + 1)
        result = results[-1]
        actions.append({'tool': name, 'args': args, 'result': result})
        record('tool-error-' + name, bool(result.get('isError')) == expect_error, result)
        if expect_error:
            return result
        return json.loads(result['result']['content'][0]['text'])

    def quit_menu(self):
        self.send('/quit')
        self.wait(lambda: 'Leave this session?' in self.view(), 'quit-menu')

    def reload(self):
        ready = sum((e['type'] == 'ready' for e in self.events()))
        self.send('/reload')
        self.wait(lambda: sum((e['type'] == 'ready' for e in self.events())) > ready, 'root-reloaded')

def native(a):
    return [json.loads(line) for line in Path(a['sessionFile']).read_text().splitlines()]

def detail_all(a, activity, section):
    page = p.tool('read', {'agentId': a['agentId'], 'view': 'activity_detail', 'activityId': activity, 'section': section})
    content = page['content']
    pages = 1
    while page['hasMore']:
        page = p.tool('read', {'agentId': a['agentId'], 'view': 'activity_detail', 'activityId': activity, 'section': section, 'detailCursor': page['nextDetailCursor']})
        content += page['content']
        pages += 1
    record('detail-' + section + '-pages', pages > 1, {'pages': pages})
    return content

def spawned(task='FIRST_CHILD', **options):
    a = p.tool('spawn', {'task': task, **options})['agent']
    children.append(a)
    owned.add(a['tmux']['panePid'])
    server = tm('display-message', '-p', '#{pid}')
    owned.add(int(server.stdout.strip()))
    record('child-identity', int(tm('display-message', '-p', '-t', a['tmux']['paneId'], '#{pane_pid}').stdout.strip()) == a['tmux']['panePid'])
    return a

def waited(a, cursor=None):
    return p.tool('wait', {'agentId': a['agentId'], 'afterSettled': cursor or a['settledCursor'], 'timeoutMs': 10000})

def child_events(a):
    f = home / f"events-{a['tmux']['panePid']}.jsonl"
    return [json.loads(l) for l in f.read_text().splitlines()] if f.exists() else []

def journey():
    global p
    p = Terminal()
    a = spawned(agent_type='worker', model='audit/deterministic')
    record('explicit-overrides-role', a['model'] == 'audit/deterministic')
    record('first-settled', waited(a)['outcome'] == 'settled')
    record('receipt-persisted', 'subagent_delivery' in Path(a['sessionFile']).read_text())
    listing = p.tool('list', {})
    record('capacity-one', listing['capacity'] == {'active': 1, 'pending': 0, 'limit': 3, 'available': 2})
    p.quit_menu()
    p.keys(b'\x1b', 'Escape cancel')
    p.wait(lambda: 'Leave this session?' not in p.view(), 'quit-cancelled')
    record('cancel-keeps-root-child', alive(p.pid) and alive(a['tmux']['panePid']))
    ready = sum((e['type'] == 'ready' for e in p.events()))
    p.send('/reload')
    p.wait(lambda: sum((e['type'] == 'ready' for e in p.events())) > ready, 'root-reloaded')
    delivery = p.tool('prompt', {'agentId': a['agentId'], 'text': 'AFTER_RELOAD'})
    record('prompt-receipt', bool(delivery.get('deliveryId')))
    record('after-reload-settled', waited(a, delivery['agent']['settledCursor'])['outcome'] == 'settled')
    recent = p.tool('read', {'agentId': a['agentId'], 'view': 'recent_activity'})
    record('recent-persisted', 'AFTER_RELOAD' in json.dumps(recent))
    parent_file = sessions[-1]['file']
    p.quit_menu()
    p.keys(b'\x1b[B\r', 'Down Enter: Leave temporarily')
    p.wait(lambda: p.status is not None, 'root-left')
    record('leave-keeps-child', alive(a['tmux']['panePid']), {'childPid': a['tmux']['panePid']})
    p = Terminal(parent_file)
    listing = p.tool('list', {})
    record('resume-same-child', listing['agents'][0]['agentId'] == a['agentId'])
    ready = sum((e['type'] == 'ready' for e in p.events()))
    p.send('/reload')
    p.wait(lambda: sum((e['type'] == 'ready' for e in p.events())) > ready, 'resumed-root-reloaded')
    listing = p.tool('list', {})
    record('resume-reload-same-child', listing['agents'][0]['agentId'] == a['agentId'] and alive(a['tmux']['panePid']))
    delivery = p.tool('prompt', {'agentId': a['agentId'], 'text': 'AFTER_RESUME'})
    record('resumed-prompt-settled', waited(a, delivery['agent']['settledCursor'])['outcome'] == 'settled')
    record('resumed-native-turn', 'AFTER_RESUME' in Path(a['sessionFile']).read_text())
    owner = p
    contender = Terminal(parent_file)
    p = contender
    p.tool('prompt', {'agentId': a['agentId'], 'text': 'COMPETING_WRITER'}, True)
    record('owner-refuses-competing-prompt', 'COMPETING_WRITER' not in Path(a['sessionFile']).read_text() and alive(a['tmux']['panePid']))
    p.send('/quit')
    p.wait(lambda: p.status is not None, 'contender-ended')
    p = owner
    delivery = p.tool('prompt', {'agentId': a['agentId'], 'text': 'OWNER_STILL_CONTROLS'})
    record('owner-still-controls', waited(a, delivery['agent']['settledCursor'])['outcome'] == 'settled')
    (root / 'suppress-confirmation').write_text(a['sessionFile'])
    unconfirmed = p.tool('prompt', {'agentId': a['agentId'], 'text': 'ACCEPTED_WITHOUT_CONFIRMATION'}, True)
    Path(a['sessionFile']).chmod(384)
    (root / 'suppress-confirmation').unlink()
    record('unconfirmed-classification', 'delivery_unconfirmed' in json.dumps(unconfirmed))
    p.tool('list', {})
    p.tool('read', {'agentId': a['agentId'], 'view': 'recent_activity'})
    users = [e for e in native(a) if e.get('type') == 'message' and e.get('message', {}).get('role') == 'user' and ('ACCEPTED_WITHOUT_CONFIRMATION' in json.dumps(e))]
    record('unconfirmed-accepted-once-no-resend', len(users) == 1 and alive(a['tmux']['panePid']))
    for fault in ['model_unavailable', 'authentication_unavailable', 'authentication_failed']:
        requests = sum((e['type'] == 'request' for e in child_events(a)))
        (home / 'preflight-fault').write_text(fault)
        rejected = p.tool('prompt', {'agentId': a['agentId'], 'text': 'REJECT_' + fault}, True)
        state = json.loads((agent / 'subagents/sessions' / a['agentId'] / 'state.json').read_text())
        record('delivery-rejected-' + fault, 'delivery_rejected' in json.dumps(rejected) and state['runtime']['promptRejection']['code'] == fault and ('PRIVATE_AUTH_ERROR' not in json.dumps(rejected) + json.dumps(state)))
        record('rejected-without-model-call-' + fault, sum((e['type'] == 'request' for e in child_events(a))) == requests)
        (home / 'preflight-fault').unlink()
    (root / 'fail-close').touch()
    p.tool('close', {'target': a['agentId']}, True)
    listing = p.tool('list', {})
    record('close-failure-retains-slot', listing['capacity']['active'] == 1 and alive(a['tmux']['panePid']))
    (root / 'fail-close').unlink()
    p.tool('close', {'target': a['agentId']})
    p.wait(lambda: not alive(a['tmux']['panePid']), 'closed-child')
    record('close-keeps-native', Path(a['sessionFile']).exists())
    record('close-releases-slot', p.tool('list', {})['capacity']['available'] == 3)
    before_settled = sum((e['type'] == 'settled' for e in p.events()))
    (root / 'delay-startup').touch()
    p.send('AUDIT_TOOL ' + json.dumps({'name': 'subagent_spawn', 'args': {'task': 'PENDING_STARTUP'}}))
    p.wait(lambda: (root / 'startup-entered').exists(), 'startup-held-at-tmux-boundary')
    p.send('/quit')
    p.wait(lambda: 'Subagent startup is still in progress' in p.view(), 'quit-refuses-pending-startup')
    record('pending-quit-keeps-root', alive(p.pid))
    (root / 'delay-startup').unlink()
    p.wait(lambda: sum((e['type'] == 'settled' for e in p.events())) > before_settled, 'pending-spawn-completed')
    pending_result = [e['data'] for e in p.events() if e['type'] == 'tool'][-1]
    pending_agent = json.loads(pending_result['result']['content'][0]['text'])['agent']
    children.append(pending_agent)
    owned.update([pending_agent['tmux']['panePid'], pending_agent['tmux']['serverPid']])
    waited(pending_agent)
    p.tool('close', {'target': 'all'})
    race = p.tool('audit_parallel', {'tasks': ['RACE_' + str(i) for i in range(5)]})
    record('concurrent-capacity-results', sum((x['ok'] for x in race)) == 3 and sum((not x['ok'] for x in race)) == 2, race)
    samples = json.loads((home / f'capacity-{p.pid}.json').read_text())
    record('concurrent-capacity-sampled', any((x['pending'] > 0 for x in samples)) and all((x['uniqueProcesses'] <= 3 for x in samples)), samples)
    race_agents = [json.loads(x['value']['content'][0]['text'])['agent'] for x in race if x['ok']]
    children.extend(race_agents)
    owned.update((x['tmux']['panePid'] for x in race_agents))
    owned.add(race_agents[0]['tmux']['serverPid'])
    record('concurrent-no-extra-panes', len(tm('list-panes', '-a', '-F', '#{pane_pid}').stdout.split()) == 3)
    record('concurrent-reservations-drained', p.tool('list', {})['capacity'] == {'active': 3, 'pending': 0, 'limit': 3, 'available': 0})
    p.tool('close', {'target': 'all'})
    record('concurrent-capacity-reclaimed', p.tool('list', {})['capacity']['available'] == 3)
    role_file = agent / 'agents/worker.jsonc'
    role_file.write_text('{"model":"audit/deterministic","thinkingLevel":"high","fast":true}')
    c = spawned('ROLE_SNAPSHOT', agent_type='worker')
    record('role-snapshot-before-reload', c['model'] == 'audit/role' and c['thinkingLevel'] == 'low')
    waited(c)
    p.tool('close', {'target': c['agentId']})
    p.reload()
    c = spawned('ROLE_EDITED', agent_type='worker')
    record('role-edit-after-reload', c['model'] == 'audit/deterministic' and c['thinkingLevel'] == 'high')
    waited(c)
    p.tool('close', {'target': c['agentId']})
    c = spawned('OVERRIDES', agent_type='worker', model='audit/role', thinkingLevel='off', fast=False)
    state = json.loads((agent / 'subagents/sessions' / c['agentId'] / 'state.json').read_text())
    record('explicit-all-overrides', c['model'] == 'audit/role' and c['thinkingLevel'] == 'off' and (state['launch']['fast'] is False))
    waited(c)
    p.tool('close', {'target': c['agentId']})
    role_file.write_text('{"model":"audit/deterministic","unknown":true}')
    p.reload()
    p.tool('spawn', {'task': 'INVALID_ROLE', 'agent_type': 'worker'}, True)
    role_file.unlink()
    p.reload()
    p.tool('spawn', {'task': 'DELETED_ROLE', 'agent_type': 'worker'}, True)
    role_file.write_text('{"model":"audit/role","thinkingLevel":"low"}')
    p.reload()
    for model in ['deterministic', 'audit/unknown', 'missing/unknown']:
        p.tool('spawn', {'task': 'INVALID_MODEL', 'model': model}, True)
    record('invalid-role-model-no-resource', p.tool('list', {})['capacity']['active'] == 0 and tm('list-panes', '-a', '-F', '#{pane_pid}').returncode != 0)
    b = spawned('HOLD_CHILD')
    p.wait(lambda: any((e['type'] == 'holding' for e in child_events(b))), 'child-holding')
    queued = p.tool('prompt', {'agentId': b['agentId'], 'text': 'QUEUED_CHILD', 'delivery': 'follow_up'})
    record('follow-up-confirmed', queued['confirmation'] == 'follow_up_queue')
    record('wait-current-generation-timeout', p.tool('wait', {'agentId': b['agentId'], 'afterSettled': queued['agent']['settledCursor'], 'timeoutMs': 100})['outcome'] == 'timeout')
    (home / 'release').touch()
    record('queued-settled', waited(b, queued['agent']['settledCursor'])['outcome'] == 'settled')
    delivery = p.tool('prompt', {'agentId': b['agentId'], 'text': 'LARGE_CHILD'})
    waited(b, delivery['agent']['settledCursor'])
    r = p.tool('read', {'agentId': b['agentId'], 'view': 'recent_activity'})
    activity = next((x for x in r['activity'] if x['kind'] == 'assistant'))
    detail = p.tool('read', {'agentId': b['agentId'], 'view': 'activity_detail', 'activityId': activity['id'], 'section': 'assistant_text'})
    record('detail-first-page', detail['returnedBytes'] <= 16384 and detail['hasMore'])
    full = detail['content']
    while detail['hasMore']:
        detail = p.tool('read', {'agentId': b['agentId'], 'view': 'activity_detail', 'activityId': activity['id'], 'section': 'assistant_text', 'detailCursor': detail['nextDetailCursor']})
        full += detail['content']
    record('detail-exact-content', full == 'LARGE_BEGIN_' + '字' * 40000 + '_LARGE_END')
    delivery = p.tool('prompt', {'agentId': b['agentId'], 'text': 'LARGE_CHILD_SECOND'})
    waited(b, delivery['agent']['settledCursor'])
    turns = p.tool('read', {'agentId': b['agentId'], 'view': 'turns', 'limit': 20})
    record('turns-multiple-pages', turns['view'] == 'turns' and turns['hasMore'])
    snapshot = turns['cursor']
    turn_pages = [turns]
    delivery = p.tool('prompt', {'agentId': b['agentId'], 'text': 'AFTER_SNAPSHOT'})
    waited(b, delivery['agent']['settledCursor'])
    while turns['hasMore']:
        turns = p.tool('read', {'agentId': b['agentId'], 'view': 'turns', 'pageCursor': turns['nextPageCursor']})
        record('turns-stable-snapshot', turns['cursor'] == snapshot)
        turn_pages.append(turns)
    record('turns-excludes-later-append', 'AFTER_SNAPSHOT' not in json.dumps(turn_pages))
    ids = [act['id'] for page in turn_pages for turn in page['turns'] for act in turn['activity']]
    record('turns-no-duplicate-activity', len(ids) == len(set(ids)))
    incremental = p.tool('read', {'agentId': b['agentId'], 'view': 'turns', 'after': snapshot})
    record('turns-incremental-later-append', 'AFTER_SNAPSHOT' in json.dumps(incremental))
    record('incremental-empty-repeat', not p.tool('read', {'agentId': b['agentId'], 'view': 'turns', 'after': incremental['cursor']})['turns'])
    delivery = p.tool('prompt', {'agentId': b['agentId'], 'text': 'TOOL_CHILD'})
    waited(b, delivery['agent']['settledCursor'])
    r = p.tool('read', {'agentId': b['agentId'], 'view': 'recent_activity'})
    tool = next((x for x in r['activity'] if x['kind'] == 'tool'))
    record('detail-tool-arguments-exact', json.loads(detail_all(b, tool['id'], 'tool_arguments'))['text'] == 'ARGS_BEGIN_' + '参' * 12000 + '_ARGS_END')
    record('detail-tool-result-exact', 'RESULT_BEGIN_' + '文' * 40000 + '_RESULT_END' in detail_all(b, tool['id'], 'tool_result'))
    delivery = p.tool('prompt', {'agentId': b['agentId'], 'text': 'GENERATE_LONG_USER'})
    waited(b, delivery['agent']['settledCursor'])
    turn = p.tool('read', {'agentId': b['agentId'], 'view': 'turns', 'limit': 1})['turns'][0]
    record('detail-user-exact', detail_all(b, turn['id'], 'user_text').endswith('LONG_USER_' + '字' * 12000))
    delivery = p.tool('prompt', {'agentId': b['agentId'], 'text': 'ERROR_CHILD'})
    waited(b, delivery['agent']['settledCursor'])
    r = p.tool('read', {'agentId': b['agentId'], 'view': 'recent_activity'})
    err = next((x for x in r['activity'] if x['kind'] == 'assistant'))
    record('bounded-error', err['stopReason'] == 'error' and len(err['errorMessage'].encode()) <= 512)
    record('detail-assistant-error-exact', detail_all(b, err['id'], 'assistant_error') == 'Error: Controlled child error ' + 'e' * 24000)
    record('partial-error-text-retained', err['text'] == 'PARTIAL_BEFORE_ERROR')
    delivery = p.tool('prompt', {'agentId': b['agentId'], 'text': 'FAIL_TOOL_CHILD'})
    waited(b, delivery['agent']['settledCursor'])
    r = p.tool('read', {'agentId': b['agentId'], 'view': 'recent_activity'})
    record('tool-error-summary', any((x['kind'] == 'tool' and x.get('outcome') == 'failed' and ('Controlled tool failure' in x.get('errorPreview', '')) for x in r['activity'])))
    c = spawned('FINAL_CHILD', agent_type='worker')
    record('role-used', c['model'] == 'audit/role')
    waited(c)
    p.tool('read', {'agentId': c['agentId'], 'view': 'turns', 'after': snapshot}, True)
    record('identity-tamper-injected', tm('set-option', '-p', '-t', c['tmux']['paneId'], '@pi_subagent_instance', 'replacement-instance').returncode == 0)
    before_native = Path(c['sessionFile']).read_text()
    listing = p.tool('list', {})
    record('identity-diagnostic-retains-slot', bool(listing.get('diagnostics')) and listing['capacity']['active'] == 2)
    p.tool('prompt', {'agentId': c['agentId'], 'text': 'MUST_NOT_DELIVER'}, True)
    record('identity-refuses-native-turn', Path(c['sessionFile']).read_text() == before_native)
    tm('set-option', '-p', '-t', c['tmux']['paneId'], '@pi_subagent_instance', c['tmux']['processInstanceId'])
    (root / 'fail-close').touch()
    p.quit_menu()
    p.keys(b'\r', 'Enter End session with controlled close failure')
    p.wait(lambda: 'Could not end the session' in p.view(), 'quit-close-failed')
    record('quit-failure-keeps-session', alive(p.pid) and alive(b['tmux']['panePid']) and alive(c['tmux']['panePid']))
    (root / 'fail-close').unlink()
    original = p
    p = Terminal()
    foreign_root = p
    foreign = spawned('OTHER_NAMESPACE')
    waited(foreign)
    p = original
    p.tool('close', {'target': 'all'})
    record('close-all-only-current-namespace', alive(foreign['tmux']['panePid']) and (not alive(b['tmux']['panePid'])) and (not alive(c['tmux']['panePid'])))
    c = spawned('END_CHILD')
    waited(c)
    old_cursor = p.tool('read', {'agentId': c['agentId'], 'view': 'turns'})['cursor']
    session_count = sum((e['type'] == 'session' for e in child_events(c)))
    tm('send-keys', '-t', c['tmux']['paneId'], '-l', '/new')
    tm('send-keys', '-t', c['tmux']['paneId'], 'Enter')
    p.wait(lambda: sum((e['type'] == 'session' for e in child_events(c))) > session_count, 'child-new-session')
    new_session = next((e['data'] for e in reversed(child_events(c)) if e['type'] == 'session'))
    new_id = new_session['id']
    listing = p.tool('list', {})
    record('switched-session-single-slot', new_id != c['agentId'] and listing['capacity']['active'] == 1 and {c['agentId'], new_id}.issubset({x['agentId'] for x in listing['agents']}))
    p.tool('prompt', {'agentId': c['agentId'], 'text': 'OLD_ALIAS_MUST_NOT_DELIVER'}, True)
    p.tool('read', {'agentId': new_id, 'view': 'turns', 'after': old_cursor}, True)
    p.tool('close', {'target': c['agentId']})
    record('close-historical-alias-keeps-live-process', alive(c['tmux']['panePid']))
    delivery = p.tool('prompt', {'agentId': new_id, 'text': 'AFTER_NEW_SESSION'})
    record('new-session-continues', p.tool('wait', {'agentId': new_id, 'afterSettled': delivery['agent']['settledCursor'], 'timeoutMs': 10000})['outcome'] == 'settled' and 'AFTER_NEW_SESSION' in Path(new_session['file']).read_text())
    active = delivery['agent']
    delivery = p.tool('prompt', {'agentId': new_id, 'text': 'BEFORE_TREE'})
    p.tool('wait', {'agentId': new_id, 'afterSettled': delivery['agent']['settledCursor'], 'timeoutMs': 10000})
    before_tree = p.tool('read', {'agentId': new_id, 'view': 'recent_activity'})['cursor']
    tree_events = sum((e['type'] == 'tree' for e in child_events(c)))
    tm('send-keys', '-t', c['tmux']['paneId'], '-l', '/tree')
    tm('send-keys', '-t', c['tmux']['paneId'], 'Enter')
    p.wait(lambda: 'Session Tree' in tm('capture-pane', '-p', '-t', c['tmux']['paneId']).stdout, 'child-tree-selector')
    tm('send-keys', '-t', c['tmux']['paneId'], '-l', 'after_new_session')
    tm('send-keys', '-t', c['tmux']['paneId'], 'Enter')
    p.wait(lambda: 'Summarize branch?' in tm('capture-pane', '-p', '-t', c['tmux']['paneId']).stdout, 'tree-summary-choice')
    tm('send-keys', '-t', c['tmux']['paneId'], 'Enter')
    p.wait(lambda: sum((e['type'] == 'tree' for e in child_events(c))) > tree_events, 'tree-navigated')
    record('cursor-no-repeat-after-tree', not p.tool('read', {'agentId': new_id, 'view': 'recent_activity', 'after': before_tree})['activity'])
    delivery = p.tool('prompt', {'agentId': new_id, 'text': 'AFTER_TREE'})
    p.tool('wait', {'agentId': new_id, 'afterSettled': delivery['agent']['settledCursor'], 'timeoutMs': 10000})
    after_tree = p.tool('read', {'agentId': new_id, 'view': 'recent_activity', 'after': before_tree})
    record('cursor-continues-after-tree', any(('AFTER_TREE' in x.get('text', '') for x in after_tree['activity'])))
    p.tool('read', {'agentId': new_id, 'view': 'turns', 'after': before_tree}, True)
    (home / 'release').unlink()
    delivery = p.tool('prompt', {'agentId': new_id, 'text': 'HOLD_CHILD_ABORT'})
    p.wait(lambda: any((e['type'] == 'request' and 'HOLD_CHILD_ABORT' in e['data']['text'] for e in child_events(c))), 'child-holding-for-abort')
    tm('send-keys', '-t', c['tmux']['paneId'], 'Escape')
    p.tool('wait', {'agentId': new_id, 'afterSettled': delivery['agent']['settledCursor'], 'timeoutMs': 10000})
    r = p.tool('read', {'agentId': new_id, 'view': 'recent_activity'})
    record('aborted-assistant-retained', any((x.get('stopReason') == 'aborted' for x in r['activity'])))
    root_aborts = sum((e['type'] == 'aborted' for e in p.events()))
    p.send('HOLD_ROOT')
    p.wait(lambda: any((e['type'] == 'root-holding' for e in p.events())), 'main-holding')
    p.quit_menu()
    p.keys(b'\x1b', 'Escape while main busy')
    p.wait(lambda: 'Leave this session?' not in p.view(), 'busy-quit-cancelled')
    record('busy-cancel-does-not-abort', sum((e['type'] == 'aborted' for e in p.events())) == root_aborts and alive(p.pid))
    p.quit_menu()
    p.keys(b'\r', 'Enter End session')
    p.wait(lambda: p.status is not None, 'root-ended')
    record('busy-end-aborts-main', sum((e['type'] == 'aborted' for e in p.events())) > root_aborts)
    record('end-closes-owned-children', all((not alive(x['tmux']['panePid']) for x in children if x is not foreign)))
    record('end-preserves-foreign-child', alive(foreign['tmux']['panePid']))
    p = foreign_root
    p.quit_menu()
    p.keys(b'\r', 'End foreign session')
    p.wait(lambda: p.status is not None, 'foreign-root-ended')
    record('end-closes-all', all((not alive(x['tmux']['panePid']) for x in children)))
    record('native-history-retained', all((Path(x['sessionFile']).exists() for x in children)))

def legacy_journey():
    global p
    revision = '6ec995fae1086e5c00525d6e9a43055e3f625b21'
    result = subprocess.run(['git', 'ls-tree', '-r', '--name-only', revision, 'extensions/subagent/src'], capture_output=True, text=True)
    record('legacy-source-available', result.returncode == 0 and bool(result.stdout), {'revision': revision, 'stderr': result.stderr})
    for source in result.stdout.splitlines():
        target = root / 'legacy' / source
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(subprocess.run(['git', 'show', revision + ':' + source], check=True, capture_output=True).stdout)
    legacy = root / 'legacy/extensions/subagent/src/index.ts'
    state_root = root / 'legacy-state'
    legacy_env = {'PI_SUBAGENT_STATE_ROOT': str(state_root)}
    p = Terminal(extension_path=legacy, environment=legacy_env)
    parent_file = sessions[-1]['file']
    parent_id = sessions[-1]['id']
    child = spawned('LEGACY_REAL_CHILD')
    waited(child)
    state_file = state_root / 'sessions' / parent_id / 'state.json'
    record('legacy-real-v2-state', json.loads(state_file.read_text())['schemaVersion'] == 2)

    def upgrade():
        code = 'import {upgradeOffline} from ' + json.dumps(str(repo / 'extensions/subagent/dist/upgrade.js')) + '; await upgradeOffline(' + json.dumps(str(state_root)) + ',' + json.dumps(parent_id) + ');'
        result = subprocess.run([node, '--input-type=module', '-e', code], capture_output=True, text=True, env=env)
        actions.append({'upgradeCommand': [node, '--input-type=module', '-e', code], 'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
        return result
    before = state_file.read_bytes()
    record('upgrade-refuses-live-legacy-child', upgrade().returncode != 0 and state_file.read_bytes() == before)
    p.tool('close', {'target': 'all'})
    p.wait(lambda: not alive(child['tmux']['panePid']), 'legacy-child-closed')
    before = state_file.read_bytes()
    record('upgrade-refuses-live-legacy-writer', upgrade().returncode != 0 and state_file.read_bytes() == before)
    p.send('/quit')
    p.wait(lambda: p.status is not None, 'legacy-writer-stopped')
    native_before = Path(parent_file).read_bytes()
    record('offline-upgrade-stopped-writer', upgrade().returncode == 0 and json.loads(state_file.read_text())['schemaVersion'] == 3)
    record('upgrade-preserves-native-history', Path(parent_file).read_bytes() == native_before)
    record('upgrade-retry-idempotent', upgrade().returncode == 0)
    p = Terminal(parent_file, environment=legacy_env)
    new = spawned('AFTER_REAL_V2_UPGRADE')
    record('upgraded-root-continues', waited(new)['outcome'] == 'settled')
    p.tool('close', {'target': 'all'})
    p.send('/quit')
    p.wait(lambda: p.status is not None, 'upgraded-root-ended')
try:
    if len(sys.argv) > 3 and sys.argv[3] == 'legacy':
        legacy_journey()
    else:
        if len(sys.argv) > 3 and sys.argv[3] == 'leave-fault':
            (home / 'leave-fault').touch()
        journey()
    passed = True
except BaseException:
    (evidence / 'failure.txt').write_text(traceback.format_exc())
    raise
finally:
    for session in root.rglob('*.jsonl'):
        session.chmod(384)
    for t in terminals:
        (evidence / f'terminal-{t.pid}.ansi').write_bytes(t.raw)
        if t.status is None:
            try:
                os.killpg(t.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            deadline = time.monotonic() + 5
            while t.status is None and time.monotonic() < deadline:
                t.pump()
            if t.status is None:
                try:
                    os.killpg(t.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.waitpid(t.pid, 0)
                t.status = -9
        os.close(t.fd)
    panes = tm('list-panes', '-a', '-F', '#{pane_pid}')
    owned.update((int(x) for x in panes.stdout.split() if x.isdigit()))
    for a in children:
        result = tm('capture-pane', '-p', '-S', '-200', '-t', a['tmux']['paneId'])
        (evidence / f"child-{a['agentId']}.txt").write_text(result.stdout + result.stderr)
    tm('kill-server')
    deadline = time.monotonic() + 5
    while any((alive(pid) for pid in owned)) and time.monotonic() < deadline:
        time.sleep(0.05)
    live = [pid for pid in owned if alive(pid)]
    socket_result = tm('list-sessions')
    locks = [str(f.relative_to(root)) for f in root.rglob('*') if f.is_file() and any((part in {'locks', 'controllers'} for part in f.relative_to(root).parts))]
    lsof = subprocess.run(['lsof', '-nP', '-a', '-p', ','.join(map(str, owned)), '-iTCP', '-sTCP:LISTEN'], capture_output=True, text=True) if owned else subprocess.CompletedProcess([], 0, '', '')
    for name in ['agent', 'home', 'sessions', 'legacy-state']:
        if (root / name).exists():
            shutil.copytree(root / name, evidence / name, dirs_exist_ok=True)
    cleanup = {'pids': sorted(owned), 'livePids': live, 'socketUnavailable': socket_result.returncode != 0, 'socketExists': (root / 'socket').exists(), 'listeningPorts': lsof.stdout, 'locksBeforeScratchRemoval': locks, 'allStopped': not live and socket_result.returncode != 0 and (not lsof.stdout)}
    (evidence / 'journey.json').write_text(json.dumps({'passed': passed, 'processes': processes, 'sessions': sessions, 'children': children, 'actions': actions, 'assertions': checks, 'cleanup': cleanup}, ensure_ascii=False, indent=2))
    print(json.dumps({'passed': passed, 'cleanup': cleanup}))
