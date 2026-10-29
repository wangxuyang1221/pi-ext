"""Run isolated native Pi PTY acceptance with local MCP services and durable evidence."""
import codecs, errno, fcntl, json, os, pty, select, shutil, signal, socket, struct, subprocess, sys, tempfile, termios, time, traceback
from pathlib import Path
import pyte
REPO = Path(__file__).resolve().parents[3]
BASE = REPO / 'extensions/mcp/__tests__/fixtures/verification'
NODE = shutil.which('node')
CLI = REPO / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
scene = sys.argv[1] if len(sys.argv) > 1 else ''
if scene not in ['configuration', 'combination', 'diagnostics', 'reload', 'history']:
    raise SystemExit('Usage: verification-journeys.py configuration|combination|diagnostics|reload|history')
EVIDENCE = REPO / '.tmp/test-results' / f'mcp-{scene}-{time.time_ns()}'
EVIDENCE.mkdir(parents=True)
root = Path(tempfile.mkdtemp(prefix='mcp-verify-', dir=REPO / '.tmp'))
for name in ['home', 'agent', 'tmp', 'cache', 'config', 'data', 'state', 'workspace', 'sessions']:
    (root / name).mkdir()
(root / 'agent/settings.json').write_text(json.dumps({'quietStartup': True, 'compaction': {'enabled': False}, 'retry': {'enabled': False}, 'cacheWarming': 'off', 'defaultProjectTrust': 'never'}))
env = {k: os.environ[k] for k in ['PATH', 'LANG', 'TZ'] if k in os.environ}
env.update(HOME=str(root / 'home'), TMPDIR=str(root / 'tmp'), XDG_CACHE_HOME=str(root / 'cache'), XDG_CONFIG_HOME=str(root / 'config'), XDG_DATA_HOME=str(root / 'data'), XDG_STATE_HOME=str(root / 'state'), JITI_FS_CACHE=str(root / 'cache'), PI_CODING_AGENT_DIR=str(root / 'agent'), PI_CODING_AGENT_SESSION_DIR=str(root / 'sessions'), PI_OFFLINE='1', PI_TELEMETRY='0', TERM='xterm-256color', PYTHONDONTWRITEBYTECODE='1', AUDIT_EVENTS=str(root / 'events.jsonl'))
checks = []
hosts = []
services = None
service_ports = []

def records(file='events.jsonl'):
    p = root / file
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

def check(value, label, **data):
    checks.append({'label': label, 'passed': bool(value), **data})
    (EVIDENCE / 'checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2))
    assert value, label

class Host:

    def __init__(self, label, config=None, trusted=True, session=None, cli_args=None):
        self.label = label
        self.status = None
        self.raw = bytearray()
        self.actions = []
        self.screens = {}
        self.children = set()
        self.events_before = len(records())
        self.screen = pyte.Screen(140, 50)
        self.stream = pyte.Stream(self.screen)
        self.decoder = codecs.getincrementaldecoder('utf-8')('replace')
        args = [NODE, str(CLI), '--offline', '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--session-dir', str(root / 'sessions'), '--provider', 'faux', '--model', 'faux-1', '-e', str(REPO / 'extensions/mcp/dist/index.js'), '-e', str(BASE / 'provider.ts'), '--approve' if trusted else '--no-approve']
        if session:
            args += ['--session', str(session)]
        if cli_args:
            args += cli_args
        child_env = dict(env)
        if config:
            child_env['PI_MCP_CONFIG'] = str(config)
        self.args = args
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(root / 'workspace')
            os.execve(NODE, args, child_env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 140, 0, 0))
        hosts.append(self)
        if cli_args and '--resume' in cli_args:
            self.wait(lambda: 'Synthetic MCP history' in self.view(), 'CLI-resume-selector')
            self.keys(b'\r', 'Select actual CLI resume session')
        self.wait(lambda: any((x['type'] == 'ready' for x in records()[self.events_before:])), 'ready')
        self.remember()

    def view(self):
        return '\n'.join((x.rstrip() for x in self.screen.display))

    def remember(self):
        rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid='], text=True)
        parents = {int(x.split()[0]): int(x.split()[1]) for x in rows.splitlines()}
        family = {self.pid}
        while True:
            more = {c for c, p in parents.items() if p in family}
            if more <= family:
                break
            family |= more
        self.children |= family - {self.pid}

    def pump(self):
        if select.select([self.fd], [], [], 0.05)[0]:
            try:
                data = os.read(self.fd, 65536)
            except OSError as e:
                if e.errno != errno.EIO:
                    raise
                data = b''
            self.raw.extend(data)
            if b'\x1b[6n' in data:
                os.write(self.fd, b'\x1b[1;1R')
            self.stream.feed(self.decoder.decode(data))
        if self.status is None:
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.status = status

    def wait(self, predicate, label, timeout=20):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.pump()
            if predicate():
                self.screens[label] = self.view()
                return
            if self.status is not None:
                break
        self.screens[label + '-FAILED'] = self.view()
        raise AssertionError(label + '\n' + self.view())

    def send(self, text):
        self.actions.append({'at': time.monotonic(), 'text': text})
        os.write(self.fd, text.encode() + b'\r')

    def keys(self, data, label):
        self.actions.append({'at': time.monotonic(), 'keys': label})
        os.write(self.fd, data)

    def settle(self, label):
        count = len([x for x in records() if x['type'] == 'settled'])
        self.send(label)
        self.wait(lambda: len([x for x in records() if x['type'] == 'settled']) > count, label)
        return [x['data'] for x in records() if x['type'] == 'request'][-1]

    def command(self, text, expected):
        self.send(text)
        self.wait(lambda: expected in self.view(), text)

    def reload(self):
        n = len([x for x in records() if x['type'] == 'ready'])
        self.send('/mcp reload')
        self.wait(lambda: len([x for x in records() if x['type'] == 'ready']) > n, 'reload-ready')
        self.remember()

    def call(self, name, args, cancel=False):
        n = len([x for x in records() if x['type'] == 'tool'])
        s = len([x for x in records() if x['type'] == 'settled'])
        self.send('CALL ' + name + ' ' + json.dumps(args))
        if cancel:
            self.wait(lambda: any((x['type'] == 'call' and x.get('mode') == 'cancel' for x in records('server.jsonl'))), 'cancel-server-received')
            self.keys(b'\x1b', 'Escape: cancel active request')
        self.wait(lambda: len([x for x in records() if x['type'] == 'settled']) > s, 'settled-' + name + '-' + str(args))
        tools = [x['data'] for x in records() if x['type'] == 'tool']
        check(len(tools) > n, 'tool event ' + name, arguments=args)
        return tools[-1]

    def close(self):
        if self.status is None:
            self.remember()
            self.send('/quit')
            try:
                self.wait(lambda: self.status is not None, 'quit', 8)
            except AssertionError:
                os.killpg(self.pid, signal.SIGTERM)
                try:
                    self.wait(lambda: self.status is not None, 'terminate', 3)
                except AssertionError:
                    os.killpg(self.pid, signal.SIGKILL)
                    _, self.status = os.waitpid(self.pid, 0)
        os.close(self.fd)
        (EVIDENCE / (self.label + '.ansi')).write_bytes(self.raw)
        (EVIDENCE / (self.label + '.json')).write_text(json.dumps({'pid': self.pid, 'children': sorted(self.children), 'command': self.args, 'actions': self.actions, 'screens': self.screens, 'status': self.status}, ensure_ascii=False, indent=2))

    def alive(self):
        result = []
        for pid in [self.pid, *self.children]:
            try:
                os.kill(pid, 0)
                result.append(pid)
            except ProcessLookupError:
                pass
        return result

def stdio(name='local'):
    return {'command': NODE, 'args': [str(REPO / 'extensions/mcp/__tests__/fixtures/stdio-mcp-server.mjs')], 'env': {'MCP_FIXTURE_LEDGER': str(root / 'stdio-requests.jsonl')}, 'connectTimeout': 3000, 'retry': {'maxAttempts': 1, 'background': False}}

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2))
    return path

def interrupted(signum, _frame):
    raise KeyboardInterrupt('Verification interrupted by signal ' + str(signum))
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
passed = False
try:
    if scene == 'configuration':
        h = Host('template')
        h.command('/mcp-init', 'Created MCP configuration')
        template = root / 'workspace/.pi/mcp.json'
        check(template.exists(), 'trusted init creates template')
        shutil.copyfile(template, EVIDENCE / 'template.json')
        template.write_text('ORIGINAL-CONTENT')
        h.send('/mcp-init')
        h.wait(lambda: 'Overwrite' in h.view(), 'overwrite-prompt-cancel')
        h.keys(b'\x1b', 'Cancel overwrite')
        h.wait(lambda: 'Overwrite' not in h.view(), 'overwrite-cancelled')
        check(template.read_text() == 'ORIGINAL-CONTENT', 'overwrite cancel preserves original bytes')
        h.send('/mcp-init')
        h.wait(lambda: 'Overwrite' in h.view(), 'overwrite-prompt-accept')
        h.keys(b'\r', 'Accept overwrite')
        h.wait(lambda: template.read_text() != 'ORIGINAL-CONTENT', 'overwrite-accepted')
        check('filesystem' in json.loads(template.read_text())['mcpServers'], 'overwrite accept writes valid template')
        h.close()
        sentinel = root / 'untrusted-sentinel'
        unsafe = {'command': NODE, 'args': ['-e', f"require('fs').writeFileSync({json.dumps(str(sentinel))},'BAD')"]}
        save(template, {'mcpServers': {'project': stdio(), 'unsafe': unsafe}})
        h = Host('untrusted', trusted=False)
        h.command('/mcp-init', 'not trusted')
        h.command('/mcp status', 'MCP config not found.')
        check(not sentinel.exists(), 'untrusted project command not executed')
        h.close()
        save(template, {'mcpServers': {'project': stdio()}})
        global_path = save(root / 'home/.pi/agent/mcp.json', {'mcpServers': {'global': stdio()}})
        explicit = save(root / 'explicit.json', {'mcpServers': {'explicit': stdio(), 'disabled': {'disabled': True, **unsafe}, 'invalid': {'command': ''}}})
        h = Host('explicit', explicit)
        h.command('/mcp verbose', 'explicit')
        h.wait(lambda: 'Tools: echo' in h.view(), 'explicit-connected')
        check('project: connected' not in h.view() and 'global: connected' not in h.view(), 'explicit priority')
        check(not sentinel.exists(), 'disabled command not executed')
        h.command('/mcp logs', 'MCP diagnostics')
        h.keys(b'\r', 'Close diagnostics')
        h.wait(lambda: 'MCP diagnostics' not in h.view(), 'diagnostics-closed')
        explicit.write_text('{invalid')
        h.reload()
        h.command('/mcp status', 'MCP configuration is invalid.')
        check('global: connected' not in h.view(), 'invalid config does not fallback')
        h.close()
        h = Host('project')
        h.command('/mcp verbose', 'Tools: echo')
        check('project' in h.view() and 'global: connected' not in h.view(), 'project priority')
        h.close()
        template.unlink()
        h = Host('global')
        h.command('/mcp verbose', 'Tools: echo')
        check('global' in h.view(), 'global fallback')
        h.close()
    elif scene == 'combination':
        services = subprocess.Popen([NODE, str(BASE / 'local-services.mjs'), str(root)], env=env, stdout=(EVIDENCE / 'service-output.log').open('w'), stderr=subprocess.STDOUT, start_new_session=True)
        end = time.monotonic() + 10
        while not (root / 'services.json').exists() and time.monotonic() < end:
            time.sleep(0.05)
        state = json.loads((root / 'services.json').read_text())
        service_ports = [int(state[k].split(':')[2].split('/')[0]) for k in ['http', 'sse', 'offline']]
        config = save(root / 'mcp.json', {'mcpServers': {'local': stdio(), 'remote': {'type': 'streamable-http', 'url': state['http'], 'connectTimeout': 2000, 'requestTimeout': 500, 'retry': {'maxAttempts': 1, 'background': False}}, 'sse': {'type': 'sse', 'url': state['sse'], 'connectTimeout': 2000, 'requestTimeout': 200, 'maxRequestTimeout': 1200, 'retry': {'maxAttempts': 1, 'background': False}}}, 'diagnostics': {'file': {'enabled': True, 'path': str(root / 'workspace/.pi/logs/mcp.jsonl'), 'maxBytes': 4096}}})
        h = Host('combo-live', config)
        h.command('/mcp verbose', 'Tools: media, schema, work')
        check(not h.call('mcp__local__echo', {'text': 'AUDIT STDIO'})['isError'], 'stdio success')
        check(any((x['method'] == 'tools/call' and x['params']['arguments']['text'] == 'AUDIT STDIO' for x in records('stdio-requests.jsonl'))), 'stdio server received actual call')
        valid = {'kind': 'fixed', 'nested': {'choice': 42}, 'extra': {'x': 'ok'}}
        check(not h.call('mcp__sse__schema', valid)['isError'], 'const nested union and typed additionalProperties accepted')
        for invalid in [{'kind': 'wrong', 'nested': {'choice': 42}}, {'kind': 'fixed', 'nested': {'choice': {}}}, {'kind': 'fixed', 'nested': {'choice': 42}, 'extra': {'x': {}}}, {'kind': 'fixed', 'nested': {'choice': 42}, 'unexpected': 'no'}]:
            before = len([x for x in records('server.jsonl') if x['type'] == 'schema-call'])
            check(h.call('mcp__sse__schema', invalid)['isError'], 'invalid schema refused before server', arguments=invalid)
            check(before == len([x for x in records('server.jsonl') if x['type'] == 'schema-call']), 'invalid schema no side effect')
        result = h.call('mcp__sse__media', {})
        check(not result['isError'] and any((x['type'] == 'image' for x in result['result']['content'])), 'image result reaches real tool event')
        check('STRUCTURED-RESULT' in json.dumps(result), 'structuredContent reaches real result chain')
        h.wait(lambda: 'MEDIA RESULT' in h.view(), 'media-result-rendered')
        check(h.call('mcp__remote__echo', {'text': 'lost-response'})['isError'], 'HTTP interrupted call fails')
        h.wait(lambda: any((x['method'] == 'tools/call' for x in json.loads((root / 'http-requests.json').read_text())['requests'])), 'HTTP receipt persisted')
        requests = json.loads((root / 'http-requests.json').read_text())['requests']
        check(sum((r['method'] == 'tools/call' for r in requests)) == 1, 'default never replays HTTP call', requests=requests)
        h.command('/mcp reconnect remote', 'MCP server reconnected: remote')
        check(not h.call('mcp__remote__echo', {'text': 'AUDIT HTTP'})['isError'], 'HTTP reconnect then success')
        check(not h.call('mcp__sse__work', {'mode': 'complete'})['isError'], 'progress extends soft deadline')
        check(h.call('mcp__sse__work', {'mode': 'hard'})['isError'], 'progress respects hard deadline')
        h.command('/mcp reconnect sse', 'MCP server reconnected: sse')
        check(h.call('mcp__sse__work', {'mode': 'cancel'}, cancel=True)['isError'], 'native Escape cancels tool')
        h.wait(lambda: any((x['type'] == 'cancel' and x.get('mode') == 'cancel' for x in records('server.jsonl'))), 'cancel-reached-server')
        h.command('/mcp reconnect sse', 'MCP server reconnected: sse')
        check(h.call('mcp__sse__work', {'mode': 'error'})['isError'], 'business error is failed')
        h.wait(lambda: 'AUDIT BUSINESS ERROR' in h.view(), 'business-error-visible')
        h.command('/mcp logs local', 'MCP diagnostics')
        check('stdio-early-secret' not in h.view() and '[redacted]' in h.view(), 'TUI stderr redaction')
        h.keys(b'\r', 'Close diagnostics')
        h.wait(lambda: 'MCP diagnostics' not in h.view(), 'diagnostics-closed')
        live_count = len([x for x in records('server.jsonl') if x['type'] == 'call'])
        session = [x['data']['session'] for x in records() if x['type'] == 'ready'][-1]
        save(config, {'mcpServers': {}})
        h.reload()
        h.command('/mcp status', 'No MCP servers configured.')
        check(live_count == len([x for x in records('server.jsonl') if x['type'] == 'call']), 'reload does not replay')
        h.close()
        logs = list((root / 'workspace/.pi/logs').glob('mcp.jsonl*'))
        check(0 < len(logs) <= 2, 'bounded diagnostic files count')
        for file in logs:
            check(file.stat().st_size <= 4096 and file.stat().st_mode & 511 == 384, 'bounded private diagnostic file', path=str(file), size=file.stat().st_size, mode=oct(file.stat().st_mode & 511))
            for line in file.read_text().splitlines():
                json.loads(line)
        h = Host('combo-cold', config, session=session)
        h.wait(lambda: 'AUDIT BUSINESS ERROR' in h.view(), 'offline-history-visible')
        h.keys(b'\x0f', 'Ctrl+O expand offline cards')
        h.wait(lambda: 'complete' in h.view(), 'offline-expanded-original-content')
        check('AUDIT SSE complete' in bytes(h.raw).decode('utf-8', 'replace'), 'offline expansion retains complete original result')
        h.keys(b'\x0f', 'Ctrl+O collapse offline cards')
        s = len([x for x in records() if x['type'] == 'settled'])
        h.send('Confirm restored history')
        h.wait(lambda: len([x for x in records() if x['type'] == 'settled']) > s, 'cold-follow-up')
        context = [x['data'] for x in records() if x['type'] == 'request'][-1]
        check('AUDIT HTTP' in json.dumps(context) and 'AUDIT STDIO' in json.dumps(context), 'cold follow-up context retains prior results')
        result = h.call('mcp__sse__work', {'mode': 'quick'})
        check(result['isError'], 'history-only model execution refused')
        check(live_count == len([x for x in records('server.jsonl') if x['type'] == 'call']), 'history-only no service side effect')
        h.close()
    elif scene in ['diagnostics', 'reload']:
        services = subprocess.Popen([NODE, str(BASE / 'local-services.mjs'), str(root)], env=env, stdout=(EVIDENCE / 'service-output.log').open('w'), stderr=subprocess.STDOUT, start_new_session=True)
        end = time.monotonic() + 10
        while not (root / 'services.json').exists() and time.monotonic() < end:
            time.sleep(0.05)
        state = json.loads((root / 'services.json').read_text())
        service_ports = [int(state[k].split(':')[2].split('/')[0]) for k in ['http', 'sse', 'offline']]
        servers = {'sse': {'type': 'sse', 'url': state['sse'], 'connectTimeout': 2000, 'requestTimeout': 10000, 'maxRequestTimeout': 20000, 'retry': {'maxAttempts': 1, 'background': False}}}
        if scene == 'reload':
            servers['offline'] = {'type': 'streamable-http', 'url': state['offline'], 'connectTimeout': 1000, 'retry': {'maxAttempts': 1, 'background': True, 'baseDelayMs': 200, 'backgroundMaxDelayMs': 200}}
        logfile = root / 'workspace/.pi/logs/mcp.jsonl'
        config = save(root / 'mcp.json', {'mcpServers': servers, 'diagnostics': {'file': {'enabled': True, 'path': str(logfile), 'maxBytes': 65536}}})
        h = Host(scene, config)
        h.command('/mcp verbose', 'Tools: media, schema, work')
        if scene == 'diagnostics':
            h.call('mcp__sse__work', {'mode': 'diagnostics'})
            h.command('/mcp logs sse', 'MCP diagnostics')
            h.wait(lambda: 'REDACTION-CATEGORIES' in h.view(), 'diagnostic-notification-visible')
            h.wait(lambda: logfile.exists() and 'REDACTION-CATEGORIES' in logfile.read_text(), 'diagnostic-file-flushed')
            text = h.view() + logfile.read_text()
            for secret in ['synthetic-auth-secret', 'synthetic-cookie-secret', 'synthetic-env-secret', 'synthetic-password', 'synthetic-query-secret']:
                check(secret not in text, 'redacted category in TUI and file ' + secret)
            check('[redacted]' in text, 'diagnostic values replaced')
            h.keys(b'\r', 'Close diagnostics')
            h.wait(lambda: 'MCP diagnostics' not in h.view(), 'diagnostics-closed')
        else:
            h.send('CALL mcp__sse__work {"mode":"complete"}')
            h.wait(lambda: any((x['type'] == 'call' and x.get('mode') == 'complete' for x in records('server.jsonl'))), 'reload-wait-active-tool')
            before_ready = len([x for x in records() if x['type'] == 'ready'])
            save(config, {'mcpServers': {}})
            h.send('/mcp reload')
            deadline = time.monotonic() + 0.15
            while time.monotonic() < deadline:
                h.pump()
            check(len([x for x in records() if x['type'] == 'ready']) == before_ready, 'reload waits for active tool without Escape')
            h.wait(lambda: len([x for x in records() if x['type'] == 'ready']) > before_ready, 'reload-after-natural-completion')
            complete = [x for x in records('server.jsonl') if x['type'] == 'finish' and x.get('mode') == 'complete'][-1]
            check(not complete['aborted'] and complete['elapsed'] >= 550, 'reload preserves active request until normal completion', server=complete)
            h.close()
            save(config, {'mcpServers': servers})
            h = Host('reload-after-cancel', config)
            h.command('/mcp verbose', 'Tools: media, schema, work')
            h.send('CALL mcp__sse__work {"mode":"cancel"}')
            h.wait(lambda: any((x['type'] == 'call' and x.get('mode') == 'cancel' for x in records('server.jsonl'))), 'reload-active-tool')
            h.wait(lambda: len(json.loads((root / 'http-requests.json').read_text())['offline']) >= 2, 'background-retry-active')
            save(config, {'mcpServers': {}})
            before_ready = len([x for x in records() if x['type'] == 'ready'])
            h.send('/mcp reload')
            h.keys(b'\x1b', 'Cancel active request so queued reload can proceed')
            h.wait(lambda: len([x for x in records() if x['type'] == 'ready']) > before_ready, 'reload-ready-after-native-cancel')
            h.wait(lambda: any((x['type'] == 'cancel' and x.get('mode') == 'cancel' for x in records('server.jsonl'))), 'native-cancel-before-reload-reaches-server')
            h.command('/mcp status', 'No MCP servers configured.')
            time.sleep(0.3)
            before = len(json.loads((root / 'http-requests.json').read_text())['offline'])
            deadline = time.monotonic() + 0.8
            while time.monotonic() < deadline:
                h.pump()
            after = len(json.loads((root / 'http-requests.json').read_text())['offline'])
            check(before == after, 'reload leaves no stale background retry', before=before, after=after)
        h.close()
    elif scene == 'history':
        import runpy
        seed = runpy.run_path(str(REPO / 'extensions/mcp/__tests__/resume-ui-host.py'))['session']
        config = save(root / 'mcp.json', {'mcpServers': {}})
        history = root / 'sessions/history.jsonl'
        seed(history, root / 'workspace')
        original = history.read_bytes()

        def follow(h, label, include='synthetic-result', exclude='branch-error'):
            context = h.settle(label)
            text = json.dumps(context)
            check(include in text and exclude not in text, label + ' request contains selected branch only', request=context)
        for mode in ['session', 'continue', 'resume', 'blank', 'memory']:
            history.write_bytes(original)
            for file in (root / 'sessions').glob('*.jsonl'):
                if file != history:
                    file.unlink()
            target = history
            if mode == 'memory':
                folder = root / 'agent/sessions' / ('--' + str(root / 'workspace').strip('/').replace('/', '-') + '--')
                folder.mkdir(parents=True, exist_ok=True)
                target = folder / 'history.jsonl'
                target.write_bytes(original)
            h = Host('cold-' + mode, config, session=history if mode == 'session' else None, cli_args=['--continue'] if mode == 'continue' else ['--resume'] if mode == 'resume' else ['--no-session'] if mode == 'memory' else None)
            if mode in ['blank', 'memory']:
                h.send('/resume')
                h.wait(lambda: 'Synthetic MCP history' in h.view(), 'native-resume-selector-' + mode)
                before = len([x for x in records() if x['type'] == 'ready'])
                h.keys(b'\r', 'Select history in native /resume')
                h.wait(lambda: len([x for x in records() if x['type'] == 'ready']) > before, 'native-resume-selected-' + mode)
            ready = [x['data'] for x in records() if x['type'] == 'ready'][-1]
            check(ready['session'] == str(target), 'restored session identity ' + mode, identity=ready)
            h.wait(lambda: 'old-tool' in h.view(), 'restored-card-' + mode)
            h.keys(b'\x0f', 'Ctrl+O expand offline result')
            h.wait(lambda: 'synthetic-result' in h.view(), 'offline-expanded-' + mode)
            follow(h, 'Follow up after ' + mode)
            h.close()
        history.write_bytes(original)
        h = Host('native-tree', config, session=history)
        h.send('/tree')
        h.wait(lambda: 'Session Tree' in h.view(), 'native-tree-menu')
        h.keys(b'branch-error', 'Filter native tree by alternate result')
        h.wait(lambda: 'branch-error' in h.view(), 'native-tree-filtered')
        h.keys(b'\r', 'Select alternate branch')
        h.wait(lambda: 'Summarize branch?' in h.view(), 'native-tree-summary')
        h.keys(b'\r', 'Choose No summary')
        h.wait(lambda: 'Navigated to selected point' in h.view(), 'native-tree-navigated')
        h.wait(lambda: 'branch-error' in h.view() and 'synthetic-result' not in h.view(), 'native-tree-screen-excludes-original')
        follow(h, 'Follow up selected branch', include='branch-error', exclude='synthetic-result')
        check([x['data'] for x in records() if x['type'] == 'settled'][-1]['leaf'] != 'user0002', 'native tree changes current leaf')
        h.send('/tree')
        h.wait(lambda: 'Session Tree' in h.view(), 'native-tree-second-menu')
        h.keys(b'synthetic-result', 'Filter original branch result')
        h.keys(b'\r', 'Select original branch')
        h.wait(lambda: 'Summarize branch?' in h.view(), 'native-tree-second-summary')
        h.keys(b'\r', 'Choose No summary')
        h.wait(lambda: 'Navigated to selected point' in h.view(), 'native-tree-returned')
        h.wait(lambda: 'synthetic-result' in h.view() and 'branch-error' not in h.view(), 'native-tree-screen-excludes-alternate')
        follow(h, 'Follow up original branch')
        h.close()
        imported = root / 'import.jsonl'
        seed(imported, root / 'workspace')
        h = Host('native-import', config)
        before = len([x for x in records() if x['type'] == 'ready'])
        h.send('/import ' + str(imported))
        h.wait(lambda: 'Replace current session' in h.view(), 'native-import-confirm')
        h.keys(b'\r', 'Accept replace current session')
        h.wait(lambda: len([x for x in records() if x['type'] == 'ready']) > before, 'native-import-ready')
        follow(h, 'Follow up imported history')
        h.close()
    passed = True
except BaseException:
    (EVIDENCE / 'failure.txt').write_text(traceback.format_exc())
    traceback.print_exc()
finally:
    for h in hosts:
        if h.fd is not None:
            try:
                if not (EVIDENCE / (h.label + '.json')).exists():
                    h.close()
            except BaseException:
                (EVIDENCE / (h.label + '-cleanup-error.txt')).write_text(traceback.format_exc())
    if services:
        services.terminate()
        try:
            services.wait(8)
        except subprocess.TimeoutExpired:
            os.killpg(services.pid, signal.SIGKILL)
            services.wait()
    ports = []
    for port in service_ports:
        s = socket.socket()
        s.settimeout(1)
        ports.append({'port': port, 'refused': s.connect_ex(('127.0.0.1', port)) != 0})
        s.close()
    alive = [p for h in hosts for p in h.alive()]
    shutil.copytree(root, EVIDENCE / 'files', dirs_exist_ok=True)
    if not alive:
        shutil.rmtree(root)
    summary = {'passed': passed, 'root': str(root), 'evidence': str(EVIDENCE), 'pids': [h.pid for h in hosts], 'alive': alive, 'servicesPid': services.pid if services else None, 'ports': ports, 'scratchRemoved': not root.exists(), 'lockUsed': False, 'privateSockets': [], 'evidenceSurvived': True}
    (EVIDENCE / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))
    if not passed or alive or any((not p['refused'] for p in ports)):
        sys.exit(1)
