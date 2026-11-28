#!/usr/bin/env -S conda run --no-capture-output -n codex-py312 python
"""Real CLI/PTy acceptance. Substitute the model boundary; keep tools and storage real."""
import json, re, shutil, subprocess, sys, time, traceback
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[3]
sys.path.insert(0, str(REPO / 'test-support/terminal'))
from pty_journey import PtyJourney
from package_health import doctor

MODE = sys.argv[1] if len(sys.argv) > 1 else 'regular'
package = REPO/'extensions/claude-code-ui'
host = ['node', str(REPO/'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')]
journey = PtyJourney(REPO, MODE, 'claude-code-ui-cli',
                     lambda evidence, label: doctor(REPO, package, evidence, label))
ROOT, EVIDENCE = journey.root, journey.evidence
env, assertions = journey.env, journey.assertions
settings = dict(quietStartup=True, defaultProjectTrust='never', compaction={'enabled': False, 'keepRecentTokens': 128},
                retry={'enabled': False}, cacheWarming='off')
(ROOT/'agent/settings.json').write_text(json.dumps(settings))
model = 'faux-reasoning'
env['AUDIT_REASONING'] = '1'
tool_set = 'read,bash,edit,write,grep,find,ls'
journey.cli = host + ['--offline', '--no-skills', '--no-context-files', '--no-prompt-templates', '--tools', tool_set, '--session-dir', str(ROOT/'sessions'), '--provider', 'faux', '--model', model, '-e', str(REPO/'test-support/terminal/model-provider.ts')]

records = journey.records
check = journey.check
start = journey.start
view = journey.view
snap = journey.snap
pump = journey.pump
settle = journey.settle
wait = journey.wait
keys = journey.keys
command = journey.command
request = journey.request
resize = journey.resize
stop = journey.stop

def tool(name,**args): return {'name':name,'arguments':args}

def claude_code_case():
    workspace = ROOT / 'workspace'
    theme_path = ROOT / 'agent/settings.json'
    branch = 'claude-profile-proof'
    subprocess.run(['git', 'init', '--initial-branch', branch, str(workspace)],
                   env={**env, 'GIT_CONFIG_NOSYSTEM': '1'}, check=True, capture_output=True)
    palette = json.loads((package / 'themes/claude-code.json').read_text())['vars']

    def observe(feature, condition, description):
        assertions.append({'feature': 'claude-' + feature, 'assertion': description, 'passed': bool(condition)})
        if not condition:
            print(f'FAIL claude-{feature}: {description}', flush=True)

    def matches(pattern):
        return [line.rstrip() for line in journey.screen.display if re.search(pattern, line.rstrip())]

    def foreground(text, line_pattern):
        for y, line in enumerate(journey.screen.display):
            if re.search(line_pattern, line) and text in line:
                first = line.index(text)
                return {journey.screen.buffer[y][x].fg for x in range(first, first + len(text)) if not line[x].isspace()}
        return set()

    def color(name):
        return {palette[name].lstrip('#')}

    def welcome(columns, split):
        if journey.screen.columns != columns:
            resize(columns)
        snap(f'welcome-{columns}')
        rows = matches(r'^\s*[╭╰│]')
        top = next((row for row in rows if 'Claude Code v' in row), '')
        sides = [row for row in rows if row.lstrip().startswith('│') and row.endswith('│')]
        observe('welcome', top.endswith('╮') and re.search(r'Claude Code v\d+\.\d+', top)
                and foreground('╭', r'Claude Code v') == color('terracotta')
                and any('╰' in row and row.endswith('╯') for row in rows)
                and any('▜█████▛' in row for row in sides), f'{columns} columns shows a terracotta rounded card and Clawd')
        observe('welcome', bool(sides) and all(len(row) == len(top) and row.count('│') == (3 if split else 2) for row in sides),
                f'{columns} columns has aligned {"two" if split else "one"}-column card boundaries')
        body = '\n'.join(sides)
        observe('welcome', all(text in body for text in (model, 'low', 'workspace')),
                f'{columns} columns shows model, thinking and working directory')
        if columns == 140:
            observe('welcome', all(text in body for text in ('/model', 'shift+tab', 'ctrl+o', '!', branch)),
                    'Wide welcome card shows Pi key hints and the actual Git branch')

    def footer():
        return next((line for line in journey.screen.display if 'Context left:' in line and model in line), '')

    def editor_row(prompt_pattern):
        rows = journey.screen.display
        return next((y for y in range(1, journey.screen.lines - 1)
                     if re.search(prompt_pattern, rows[y])
                     and all(re.fullmatch(r'\s*─+\s*', rows[border]) for border in (y - 1, y + 1))), None)

    def composer_frame(label, draft, bash=False):
        snap(label)
        rows = journey.screen.display
        editor = editor_row(r'^\s*❯ ' + re.escape(draft) + r'\s*$')
        if editor is not None:
            cells = [journey.screen.buffer[y][x] for y in range(editor - 1, editor + 2) for x in range(journey.screen.columns)]
            rules = [{journey.screen.buffer[y][x].fg for x, glyph in enumerate(rows[y]) if glyph == '─'}
                     for y in (editor - 1, editor + 1)]
            observe('composer', {cell.bg for cell in cells} == {'default'} and rules == [color('bashPink' if bash else 'border')] * 2,
                    f'{label} has two correctly colored rules and transparent editor cells')
        else:
            observe('composer', False, f'{label} shows a separate ❯ prompt and the expected draft')
        prompt_fg = foreground('❯', r'^\s*❯ ' + re.escape(draft) + r'\s*$')
        normal = '⏵⏵ thinking:' in footer() and '! for bash mode' not in footer()
        active = '! for bash mode' in footer() and foreground('! for bash mode', r'Context left:') == color('bashPink')
        observe('composer', prompt_fg == (color('bashPink') if bash else {'f2f2f6'}) and (active if bash else normal),
                f'{label} shows the matching prompt and footer hint')

    installed_package = journey.install(host, package)
    installed_packages = json.loads(theme_path.read_text())["packages"]
    start(['--thinking', 'low'])
    check(bool(matches(r'Claude Code v')) and editor_row(r'^\s*❯ ') is not None,
          'The installed Claude package activates its welcome card and composer from a clean profile')
    themes = [event['data'] for event in records() if event['type'] == 'themes'][-1]
    external_themes = [theme for theme in themes if theme['name'] not in ('dark', 'light')]
    check(external_themes == [{'name': 'claude-code', 'path': str(installed_package/'themes/claude-code.json')}],
          'The installed package supplies the only external theme')
    observe('lifecycle', (b'\x1b[?1049h' in journey.raw) == (MODE == 'fullscreen'), 'Terminal uses the requested screen mode')
    for columns in (140, 77, 78, 80):
        welcome(columns, split=columns >= 78)
    resize(140)

    keys(b'\x1b[Z', 'Shift+Tab cycles Pi thinking'); settle()
    snap('thinking-level-cycled')
    observe('footer', bool(re.search(r'⏵⏵ thinking: medium.*' + model + rf'.* {branch}.*Context left: (?:100|\d{{1,2}})%', footer())),
            'Shift+Tab changes low to medium while model, Git branch and remaining context stay on the right')
    keys(b'CLAUDE-DRAFT', 'type a normal draft'); settle()
    composer_frame('normal composer', 'CLAUDE-DRAFT')
    keys(b'\x01!', 'Ctrl+A and insert !'); settle()
    composer_frame('bash composer', '!CLAUDE-DRAFT', bash=True)
    keys(b'\x7f', 'delete !'); settle()
    composer_frame('restored composer', 'CLAUDE-DRAFT')
    keys(b'\x05\x15', 'clear the draft before submitting a new prompt'); settle()

    prompt, reply = 'Observe Claude stream', 'CLAUDE-REPLY-PROOF'
    thought = 'CLAUDE-THINKING-PROOF'
    (ROOT / 'plan.json').write_text(json.dumps({
        'thinking': thought + ' ' + 'Test the working animation during a real provider stream. ' * 34,
        'reply': reply,
    }))
    before = len(records())
    command(prompt)
    working_pattern = r'^\s*(\S) (\S+…) \(esc to interrupt · (\d+)s · ↓ [\d.k]+ tokens\)'
    spinner_frames, shimmer_positions, elapsed_values = set(), set(), set()
    rate_seen = False
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and not any(e['type'] == 'agent_settled' for e in records()[before:]):
        pump()
        if journey.status is not None:
            break
        if not any(e['type'] == 'agent_start' for e in records()[before:]):
            continue
        for row, line in enumerate(journey.screen.display):
            match = re.search(working_pattern, line)
            if not match or row + 2 >= journey.screen.lines or not re.match(r'^\s*─+', journey.screen.display[row + 1]) or not re.match(r'^\s*❯ ', journey.screen.display[row + 2]):
                continue
            spinner, verb, elapsed = match.groups()
            if foreground(spinner, working_pattern) == color('terracotta'):
                spinner_frames.add(spinner)
            colors = [journey.screen.buffer[row][x].fg for x in range(*match.span(2))]
            if len(set(colors)) > 1 and 'f6b290' in colors:
                position = colors.index('f6b290')
                if position not in shimmer_positions and len(shimmer_positions) < 2:
                    snap(f'shimmer at column {position + match.start(2)}')
                shimmer_positions.add(position)
            elapsed_values.add(int(elapsed))
            if re.search(r'≈\s*[\d.]+[kM]?\s*t/s', footer()):
                if not rate_seen:
                    snap('working-with-live-rate')
                rate_seen = True
        if len(elapsed_values) >= 2 and len(spinner_frames) >= 2 and len(shimmer_positions) >= 2 and rate_seen:
            snap('working-later-frame')
            break
    wait(lambda: any(e['type'] == 'agent_settled' for e in records()[before:]), 'Claude stream settled')
    settle(); snap('Claude stream idle')
    observe('working', len(spinner_frames) >= 2 and len(shimmer_positions) >= 2 and len(elapsed_values) >= 2,
            'Live Working above the editor animates a terracotta spinner and shimmer with elapsed time and tokens')
    observe('footer', rate_seen and not re.search(r't/s|≈', footer()) and not matches(working_pattern),
            'The footer shows a live rate and clears it with Working after settlement')
    observe('messages', bool(matches(r'^\s*❯ ' + prompt + '$') and matches(r'^\s*● ' + reply + '$')),
            'User and assistant prose display ❯ and ● prefixes')
    thought_row = next((y for y, line in enumerate(journey.screen.display) if thought in line), None)
    observe('messages', bool(matches(r'^\s*∴ Thinking…\s*$')) and thought_row is not None
            and foreground(thought, thought) == color('thinking')
            and journey.screen.buffer[thought_row][journey.screen.display[thought_row].index(thought)].italics,
            'Expanded Thinking has its own title and muted italic body')
    keys(b'\x14', 'Ctrl+T collapses Thinking'); settle(); snap('Thinking collapsed')
    observe('messages', bool(matches(r'^\s*∴ Thinking… \(ctrl\+t to expand\)\s*$')) and thought not in view(),
            'Ctrl+T hides the body and displays the Claude expand hint')
    keys(b'\x14', 'Ctrl+T expands Thinking'); settle(); snap('Thinking re-expanded')
    observe('messages', thought in view(), 'Ctrl+T restores the thinking body')

    read_a, read_b = 'first.txt', 'second.txt'
    (workspace / read_a).write_text('SINGLE-READ-PROOF\n')
    (workspace / read_b).write_text('GROUP-READ-PROOF\n')
    request('Single Read probe', {'calls': [tool('read', path=read_a)]})
    observe('tools', bool(matches(r'^\s*● Read\(first\.txt\)\s*$')) and 'SINGLE-READ-PROOF' not in view(),
            'A single Read uses the Claude title and hides its body while collapsed')
    request('Grouped Read probe', {'calls': [tool('read', path=read_a), tool('read', path=read_b)]})
    observe('tools', bool(matches(r'^\s*● Read 2 files') and matches(r'^\s+⎿  first\.txt'))
            and 'GROUP-READ-PROOF' not in view(), 'Consecutive Read calls show one two-file heading and a connector')
    request('Write a file', {'calls': [tool('write', path='proof.txt', content='ORIGINAL-LINE\n')]})
    observe('tools', (workspace / 'proof.txt').read_bytes() == b'ORIGINAL-LINE\n', 'Write persists the expected bytes')
    results = request('Edit that file', {'calls': [
        tool('edit', path='proof.txt', edits=[{'oldText': 'ORIGINAL-LINE', 'newText': 'REPLACEMENT-LINE'}]),
    ]})
    for verb, summary in [('Write', 'Wrote 1 line to proof.txt'), ('Update', 'Added 1 line, removed 1 line')]:
        observe('tools', bool(matches(r'^\s*● ' + verb + r'\(proof\.txt\)') and matches(r'^\s+⎿  ' + re.escape(summary))),
                f'{verb} shows its Claude title, connector and line count')
    observe('tools', [result['toolName'] for result in results[-4:]] == ['read', 'read', 'write', 'edit']
            and all(not result['isError'] for result in results[-4:])
            and (workspace / 'proof.txt').read_bytes() == b'REPLACEMENT-LINE\n', 'Read, Write and Edit really run and persist the expected bytes')
    keys(b'\x0f', 'Ctrl+O expands Read and diff'); settle(); snap('expanded Read and diff')
    observe('tools', 'GROUP-READ-PROOF' in view() and foreground('+', r'\+\s+REPLACEMENT-LINE') == color('green')
            and foreground('-', r'-\s+ORIGINAL-LINE') == color('red'), 'Expanded grouped Read and red/green Edit diff are visible')
    keys(b'\x0f', 'Ctrl+O collapses Read and diff'); settle(); snap('recollapsed Read and diff')
    observe('tools', 'GROUP-READ-PROOF' not in view(), 'Ctrl+O hides the grouped Read body again')

    (workspace / 'capture.log').write_text('界' * 18000 + '\nBASH-FIRST\nBASH-SECOND\nBASH-MIDDLE\nBASH-NEXT\nBASH-PREV\nBASH-LAST\n')
    shell = 'cat capture.log; exit 7'
    event = request('Truncated failing Bash', {'calls': [tool('bash', command=shell)], 'reply': 'BASH-REPLY'})[-1]
    details = event['result'].get('details') or {}
    saved = Path(details.get('fullOutputPath') or '.')
    saved_in_scratch = saved.is_relative_to(ROOT / 'tmp') and saved.is_file()
    if saved_in_scratch:
        shutil.copyfile(saved, EVIDENCE / 'bash-full-output.log')
    observe('tools', event['toolName'] == 'bash' and event['isError'] and saved_in_scratch
            and saved.read_bytes() == (workspace / 'capture.log').read_bytes(),
            'Stock Bash fails and saves the complete oversized output')
    for expanded in (False, True):
        if expanded:
            keys(b'\x0f', 'Ctrl+O expands the captured Bash tail'); settle(); snap('expanded Bash')
        card = view().rsplit('Truncated failing Bash', 1)[-1].split('BASH-REPLY', 1)[0]
        observe('tools', '● Bash(' + shell + ')' in card and 'Error: Exit code 7' in card
                and '⎿  BASH-FIRST' in card and 'BASH-LAST' in card and card.count('Truncated capture ·') == 1
                and ''.join(str(saved).split()) in ''.join(card.split()) and ('BASH-MIDDLE' in card) == expanded,
                f'Claude Bash displays its title, exit code, captured tail and saved path (expanded={expanded})')
    keys(b'\x0f', 'Ctrl+O restores collapsed tools'); settle()

    probe = workspace / 'probe'
    probe.mkdir()
    (probe / 'match.txt').write_text('SEARCH-NEEDLE exact-match\n')
    results = request('Search Glob List probe', {'calls': [
        tool('grep', pattern='SEARCH-NEEDLE', path='probe'), tool('find', pattern='*.txt', path='probe'),
        tool('ls', path='probe'),
    ], 'reply': 'GENERIC-REPLY'})[-3:]
    observe('tools', sorted(event['toolName'] for event in results) == ['find', 'grep', 'ls']
            and all(not event['isError'] for event in results)
            and all('match.txt' in json.dumps(event['result']) for event in results), 'Real grep, find and ls return the seeded path')
    section = view().rsplit('Search Glob List probe', 1)[-1].split('GENERIC-REPLY', 1)[0]
    observe('tools', all(re.search(r'^\s*● ' + heading + r'\(', section, re.M) for heading in ('Search', 'Glob', 'List'))
            and section.count('⎿  ') == 3 and 'exact-match' not in section,
            'Collapsed grep, find and ls show Search, Glob and List with connectors')
    keys(b'\x0f', 'Ctrl+O expands Search, Glob and List'); settle(); snap('expanded Search Glob List')
    section = view().rsplit('Search Glob List probe', 1)[-1].split('GENERIC-REPLY', 1)[0]
    observe('tools', 'exact-match' in section and section.count('match.txt') == 3,
            'Ctrl+O reveals the actual results of Search, Glob and List')

    stop()
    start(['--thinking', 'low'])
    def persisted(label):
        snap(label)
        observe('lifecycle', json.loads(theme_path.read_text()).get('packages') == installed_packages
                and bool(matches(r'Claude Code v')) and editor_row(r'^\s*❯ ') is not None,
                f'{label} keeps the installed package and renders the Claude header and composer')

    def change_session(reason):
        before = len(records())
        command('/' + reason)
        if reason in ('fork', 'resume'):
            settle(); snap(reason + ' selector')
            keys(b'\r', f'Choose the first {reason} entry')
        wait(lambda: any(event['type'] == 'session_start' and event['data']['reason'] == reason
                         for event in records()[before:]), reason + ' session lifecycle')
        settle()
        persisted('after /' + reason)

    persisted('after restart')
    request('Persisted profile turn', {'reply': 'PERSISTED-REPLY'})
    for reason in ('reload', 'fork'):
        change_session(reason)
    keys(b'\x03', 'clear fork prefill'); settle()
    request('Forked profile turn', {'reply': 'FORKED-REPLY'})
    for reason in ('new', 'resume'):
        change_session(reason)
    stop()


passed = False
try:
    claude_code_case()
    passed = all(assertion['passed'] for assertion in assertions)
except Exception:
    (EVIDENCE/'failure.txt').write_text(traceback.format_exc())
    print(traceback.format_exc())
finally:
    passed = journey.finish(passed)
sys.exit(0 if passed else 1)
