#!/usr/bin/env -S conda run --no-capture-output -n codex-py312 python
"""Real CLI/PTy acceptance. Substitute the model boundary; keep tools and storage real."""
import base64, json, re, sys, traceback
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[3]
sys.path.insert(0, str(REPO / 'test-support/terminal'))
from pty_journey import PtyJourney
from pi_170_journey import verify_pi_170
from package_health import doctor

def tone(name):
    theme = json.loads((REPO / 'extensions/codex-ui/themes/codex-pi.json').read_text()); value = theme['colors'][name]
    return theme['vars'].get(value, value).lstrip('#').lower()
CODEX_BG = tone('selectedBg')
CODEX_FG, TOOL_FG, THINKING_FG, QUOTE_BORDER_FG = 'd4d4d8', '9a9aa2', '787882', '44444c'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'regular'
PI_COMPAT = '--pi-compat' in sys.argv
package = REPO/'extensions/codex-ui'
journey = PtyJourney(REPO, MODE, 'codex-ui-cli'+('-pi-compat' if PI_COMPAT else ''),
                     lambda evidence, label: doctor(REPO, package, evidence, label))
ROOT, EVIDENCE = journey.root, journey.evidence
env, actions, assertions = journey.env, journey.actions, journey.assertions
settings = dict(quietStartup=True, defaultProjectTrust='never', compaction={'enabled': False,'keepRecentTokens':128}, retry={'enabled': False}, cacheWarming='off')
if PI_COMPAT:
    settings['fullscreenScrollbar'] = 'always'
(ROOT/'agent/settings.json').write_text(json.dumps(settings))
(ROOT/'workspace/.pi').mkdir()
(ROOT/'workspace/.pi/settings.json').write_text(json.dumps({'shellCommandPrefix': 'export AUDIT_PREFIX=untrusted'}))
(ROOT/'workspace/read.txt').write_text('READ-CONTENT\n')
(ROOT/'plan.json').write_text(json.dumps({'reply': 'AUDIT-DONE'}))
model = 'faux-text-only' if PI_COMPAT else 'faux-1'
if PI_COMPAT:
    env['AUDIT_TEXT_ONLY'] = '1'
host = ['node', str(REPO/'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')]
tool_set = '+codemode'
journey.cli = host + ['--offline', '--no-skills', '--no-context-files', '--no-prompt-templates', '--tools', tool_set, '--session-dir', str(ROOT/'sessions'), '--provider', 'faux', '--model', model, '-e', str(BASE/'model-provider.ts')]

records = journey.records
check = journey.check
start = journey.start
view = journey.view
snap = journey.snap
settle = journey.settle
wait = journey.wait
keys = journey.keys
command = journey.command
titles = journey.titles
request = journey.request
reload = journey.reload
save_settings = journey.save_settings
resize = journey.resize
stop = journey.stop

def bash_output_started(events, marker):
    return any(event['type']=='tool_execution_update' and event['data']['toolName']=='bash'
               and any(block.get('type')=='text' and marker in block.get('text','')
                       for block in event['data'].get('partialResult',{}).get('content',[]))
               for event in events)

def tool(name,**args): return {'name':name,'arguments':args}

def composer(label,expected_bg=CODEX_BG):
    keys(b'\x15COMPOSER-INPUT',label+' input'); settle()
    row=next(y for y,line in enumerate(journey.screen.display) if 'COMPOSER-INPUT' in line)
    colors={journey.screen.buffer[row][x].bg for x in range(journey.screen.columns)}
    check(len(colors)==1 and 'default' not in colors,label+' paints the complete composer row')
    check(all({journey.screen.buffer[y][x].bg for x in range(journey.screen.columns)}==colors for y in [row-1,row+1]),label+' paints the blank padding rows')
    if expected_bg:check(colors=={expected_bg},label+' uses the selected theme background')
    else:check(colors!={CODEX_BG},label+' changes composer background from codex-pi')
    start=journey.screen.display[row].index('COMPOSER-INPUT')
    foregrounds={journey.screen.buffer[row][x].fg for x in range(start,start+len('COMPOSER-INPUT'))}
    check(len(foregrounds)==1 and 'default' not in foregrounds and foregrounds!=colors,label+' paints readable draft text with the selected theme')
    if expected_bg==CODEX_BG:check(foregrounds=={CODEX_FG},label+' uses the codex-pi text color')
    snap(label); keys(b'\x15',label+' clear')

def native_resume(label):
    n=sum(e['type']=='session_start' for e in records()); command('/resume'); settle(.8);snap(label+' selector')
    keys(b'\r',label+' choose first session')
    wait(lambda:sum(e['type']=='session_start' for e in records())>n,label+' resumed');settle()

def command_availability(label):
    commands=[entry['name'] for entry in [e for e in records() if e['type']=='commands'][-1]['data']]
    check('inspect' in commands and 'lowpower' not in commands,label+' command registry keeps inspect and excludes lowpower')
    keys(b'\x15/inspec\t',label+' complete inspect');settle()
    check('→ inspect' in view() or '/inspect' in view(),label+' offers the available inspect command')
    keys(b'\t',label+' accept inspect completion');settle();snap(label+' inspect completion')
    check('/inspect' in view(),label+' completes the available inspect command')
    keys(b'\x15/lowp\t',label+' complete removed command');settle();snap(label+' removed command completion')
    check('/lowp' in view() and '/lowpower' not in view(),label+' has no lowpower completion')
    keys(b'\x15',label+' clear command input');settle()

def replacement_checks(label):
    command_availability(label)
    check(json.loads((ROOT/'agent/settings.json').read_text())['theme']=='codex-pi',label+' preserves selected theme')
    composer(label+' composer')

def select_theme(name):
    command('/settings');settle();keys(b'theme','filter settings by theme');settle();keys(b'\r','open theme menu');settle()
    for _ in range(8):
        if any(line.startswith('→') and re.search(r'\b'+re.escape(name)+r'\s*$',line) for line in journey.screen.display): break
        keys(b'\x1b[B','next theme');settle(.1)
    else: raise AssertionError('Theme choice not found: '+name+'\n'+view())
    snap('select theme '+name);keys(b'\r','save theme '+name);settle();keys(b'\x1b','close settings');settle()
    check(json.loads((ROOT/'agent/settings.json').read_text())['theme']==name,'Native settings saves '+name)

def locate(text, *, starts=False):
    for row, line in enumerate(journey.screen.display):
        if (line.lstrip().startswith(text) if starts else text in line):
            return row, line.index(text)
    raise AssertionError(f'Missing terminal text {text!r}\n{view()}')

def check_style(text, foreground, *, italic=False):
    row, column = locate(text)
    cells = [journey.screen.buffer[row][x] for x in range(column, column + len(text))]
    styles = {(cell.fg, cell.italics) for cell in cells if cell.data.strip()}
    check(styles == {(foreground, italic)}, f'{text!r} has terminal style {(foreground, italic)}, got {styles}')

def toggle_output_pad(before, after):
    command('/settings'); settle()
    keys(b'output padding', 'filter settings by Output padding')

    def selected(value):
        pattern = rf'^\s*→\s+Output padding\s+{value}\s*$'
        return any(re.match(pattern, line) for line in journey.screen.display)

    wait(lambda: selected(before), f'Output padding shows {before}')
    keys(b'\r', f'set Output padding to {after}')
    wait(lambda: selected(after), f'Output padding shows {after}')
    keys(b'\x1b', 'close Output padding settings'); settle()
    check(json.loads((ROOT/'agent/settings.json').read_text())['outputPad'] == after,
          f'Native settings saves outputPad={after}')

def output_padding_case():
    check('outputPad' not in json.loads((ROOT/'agent/settings.json').read_text()),
          'Output padding starts with the stock default')
    (ROOT/'workspace/pad-read.txt').write_text('PAD-READ-BODY\n')
    (ROOT/'workspace/pad-edit.txt').write_text('before\n')
    result = request('Padding user message', {'calls': [
        tool('read', path='pad-read.txt'),
        tool('bash', command='printf "BX\\n"'),
        tool('edit', path='pad-edit.txt', edits=[{'oldText': 'before', 'newText': 'PAD-EDIT-BODY'}]),
        tool('write', path='pad-write.txt', content='PAD-WRITE-BODY\n'),
        tool('codemode', code='text("P".repeat(160));'),
    ], 'reply': 'Padding reply body\n\n> Padding reply quote'})
    check({r['toolName'] for r in result[-5:] if not r['isError']} == {'read', 'bash', 'edit', 'write', 'codemode'},
          'All five real output padding tools succeed')
    check('PAD-READ-BODY' not in view(), 'Read body starts collapsed')

    def check_titles(pad, label, disclosure):
        snap(label)
        titles = ('Padding user message', 'Padding reply body', '@ Read pad-read.txt', '$ Bash(',
                  '~ Edited pad-edit.txt', '~ Added pad-write.txt', disclosure + ' Codemode · Script completed')
        for title in titles:
            _, column = locate(title, starts=True)
            check(column == pad, f'{label}: {title} starts at column {pad + 1}, got {column + 1}')

    def columns(pad, label):
        check_titles(pad, label, '▾')
        check_style('Padding reply body', 'default')
        row, column = locate('@ Read pad-read.txt', starts=True)
        title_foregrounds = {journey.screen.buffer[row][x].fg for x in range(column + len('@ '), column + len('@ Read'))}
        check(title_foregrounds == {CODEX_FG}, f'Read title uses the codex-pi toolTitle color, got {title_foregrounds}')
        check_style('Padding reply quote', THINKING_FG, italic=True)
        row, column = locate('│ Padding reply quote', starts=True)
        check(journey.screen.buffer[row][column].fg == QUOTE_BORDER_FG, 'Reply blockquote uses the quote border color')
        check_style('PAD-READ-BODY', TOOL_FG)
        row, column = locate('└ BX', starts=True)
        check({journey.screen.buffer[row][column + x].fg for x in (2, 3)} == {TOOL_FG}, 'Bash output uses the muted tool color')
        row, _ = locate('PPPPPPPP')
        check(len(journey.screen.display[row].rstrip()) == journey.screen.columns - pad,
              f'{label}: width-filling Codemode output leaves {pad} right padding cells')
        markers = ('PAD-READ-BODY', '└ BX', 'PAD-EDIT-BODY', 'PAD-WRITE-BODY', 'PPPPPPPP')
        return {marker: locate(marker)[1] for marker in markers}

    def narrow(label):
        # Keep the cards visible while native message text wraps into many rows.
        resize(2, 140); snap(label)
        check(journey.status is None, f'{label}: the CLI stays alive at two columns')
        lines = view().splitlines()
        check(any(line.startswith('@') for line in lines), f'{label}: narrow Read starts at column one')
        check(lines.count('BX') == 1, f'{label}: narrow Bash output uses both columns')
        check(sum(line.startswith('~') for line in lines) >= 2, f'{label}: narrow Edit and Write start at column one')
        check(any(line.startswith('▾') for line in lines), f'{label}: narrow Codemode starts at column one')
        resize(140)

    check_titles(1, 'Output padding default 1, collapsed', '▸')
    keys(b'\x0f', 'expand tools for output padding'); settle()
    padded = columns(1, 'Output padding default 1, expanded')
    toggle_output_pad(1, 0)
    flush = columns(0, 'Output padding toggled to 0, expanded')
    check(all(padded[marker] == column + 1 for marker, column in flush.items()),
          'Tool bodies keep their own indentation and shift with Output padding')
    narrow('Output padding 0 at two columns')
    toggle_output_pad(0, 1)
    check(columns(1, 'Output padding toggled back to 1, expanded') == padded,
          'Restoring Output padding restores all existing tool body columns')
    narrow('Output padding 1 at two columns')
    columns(1, 'Output padding 1 after resize recovery')
    keys(b'\x0f', 'restore collapsed tool view'); settle()
    command('/new'); settle()

def check_thinking_rails(label, *, complete=False):
    snap(label)
    lines = [line.rstrip() for line in journey.screen.display]
    header, border = locate('│ Thinking', starts=True)
    first, _ = locate('│ Audit reasoning', starts=True)
    code_start, code_column = locate('const fenceStart = 1;')
    code_end, _ = locate('const fenceEnd = 2;')
    next_block, _ = locate('│ Reasoning remains', starts=True)
    check(lines[header] == ' ' * border + '│ Thinking' and first == header + 2 and lines[header + 1] == '',
          f'{label}: the standalone Thinking header is followed by one blank line')
    check(lines[first + 1] == '' and lines[next_block - 1] == '' and first + 1 < code_start < code_end < next_block,
          f'{label}: the fence and neighboring paragraphs are separate quoted blocks')
    rail = ' ' * border + '│'
    check(code_end == code_start + 2 and lines[code_start + 1] == rail
          and all(lines[row].startswith(rail) for row in (code_start, code_end)),
          f'{label}: the fenced code retains its internal blank line within one quote rail')
    check(journey.screen.buffer[code_start][code_column].fg == tone('syntaxKeyword'),
          f'{label}: quoted TypeScript retains native keyword highlighting')
    if complete:
        last, _ = locate('│ LAST-THINKING-LINE', starts=True)
        check(lines[last - 1] == '' and all(line.startswith(rail + ' ') for line in lines[next_block:last - 1]),
              f'{label}: wrapped lines keep the quote rail and the final paragraph starts its own quote')
    check_style('Audit reasoning', THINKING_FG, italic=True)
    check_style('Reasoning remains', THINKING_FG, italic=True)
    check({journey.screen.buffer[row][border].fg for row in (header, first, code_start, code_start + 1, code_end, next_block)}
          == {QUOTE_BORDER_FG}, f'{label}: Thinking rails use the quote border color')

def click_thinking(marker, label):
    row, column = locate(marker, starts=True)
    coordinate = f'{column + 3};{row + 1}'
    keys(f'\x1b[<0;{coordinate}M\x1b[<0;{coordinate}m'.encode(), label)

def control_case():
    (ROOT/'workspace/controls.txt').write_bytes(b'old\r\n')
    controls='CONTROL-FIRST\x1b[2J\x1b[H\x1b]0;source-must-not-set-title\x07CONTROL-LAST\r\n'
    offset=len(journey.raw)
    request('Control character diff',{'calls':[tool('write',path='controls.txt',content=controls)]})
    keys(b'\x0f','expand control character diff');settle()
    check((ROOT/'workspace/controls.txt').read_bytes()==controls.encode(),'Display sanitization preserves original disk bytes')
    check('CONTROL-FIRSTCONTROL-LAST' in view(),'Real diff displays text surrounding source terminal controls')
    check(all(b'source-must-not-set-title' not in title for title in titles(journey.raw[offset:])),'Source OSC cannot change the terminal title')
    snap('sanitized control diff');keys(b'\x0f','collapse control character diff');settle()

def bash_capture_case():
    workspace = ROOT / 'workspace'
    temp = ROOT / 'tmp'
    parked = ROOT / 'tmp-before-capture'
    # A single oversized line is dropped when complete nonblank lines follow it.
    # The original multibyte output also fits the nested 32 Ki-character budget.
    tail = 'tail-one\ntail-two\ninner-three\ninner-four\ntail-five\nCAPTURE-END\n'
    (workspace / 'capture.txt').write_text('界' * 18000 + '\n' + tail)
    shell = 'cat capture.txt'

    def transcript():
        # Fullscreen reserves the rightmost column for its always-on scrollbar.
        width = journey.screen.columns - int(MODE == 'fullscreen')
        return '\n'.join(line[:width].rstrip() for line in journey.screen.display)

    def card(label, title, reply):
        snap(label)
        frame = transcript()
        start = frame.rfind(title)
        end = frame.find(reply, start)
        check(0 <= start < end, label + ' shows the current tool and its following reply')
        return frame[start:end].strip()

    def failed_preview(label, body, expanded, reason):
        # Terminal wrapping adds indentation, including in the middle of paths.
        compact = ''.join(body.split())
        warning = 'Truncated capture · Could not save the full output: '
        check(body.count('CAPTURE-END') == 1 and body.index('CAPTURE-END') < body.find('Truncated capture'),
              label + ' retains the real output tail above its warning')
        check(compact.count('Truncatedcapture·') == 1 and compact.count('Couldnotsavethefulloutput:') == 1
              and ''.join((warning + reason).split()) in compact and '[Showing' not in compact,
              label + ' displays the capture error once and removes the stock footer')
        check(('inner-three' in body) == expanded, label + ' shows the expected amount of captured output')

    temp.rename(parked)
    try:
        temp.touch(exist_ok=False)
        for code in (0, 7):
            command_text = shell if code == 0 else shell + ' && exit 7'
            label = f'Capture save failure exit {code}'
            reply = f'CAPTURE-DONE-{code}'
            event = request(label, {'calls': [tool('bash', command=command_text)], 'reply': reply})[-1]
            result = event['result']
            reason = result['details']['fullOutputError']
            check(event['toolName'] == 'bash' and event['isError'] == bool(code)
                  and 'ENOTDIR' in reason and 'fullOutputPath' not in result['details']
                  and '[Showing' in result['content'][0]['text'],
                  label + ' receives the stock truncated result and expected shell status')
            title = f'$ Bash({command_text})'
            for expanded in (False, True):
                if expanded:
                    keys(b'\x0f', 'expand ' + label); settle()
                state = label + (' expanded' if expanded else ' collapsed')
                body = card(state, title, reply)
                check(body.splitlines()[0].rstrip() == title + (f' · exit {code}' if code else ''),
                      state + ' keeps the command exit status on the title')
                failed_preview(state, body, expanded, reason)
            keys(b'\x0f', 'collapse ' + label); settle()

        label = 'Nested capture save failure'
        reply = 'NESTED-CAPTURE-DONE'
        script = 'await tools.bash({command:"cat capture.txt"}); text("child finished");'
        child_event, event = request(label, {'calls': [tool('codemode', code=script)], 'reply': reply})[-2:]
        check(event['toolName'] == 'codemode' and not event['isError'], 'Real nested script completes')
        check(child_event['toolName'] == 'bash' and child_event['toolCallId'] == event['result']['details']['calls'][0]['id']
              and len(json.dumps(child_event['result'], ensure_ascii=False)) < 32 * 1024,
              'The nested Bash result fits the capture budget and belongs to this script')
        reason = child_event['result']['details']['fullOutputError']
        check('ENOTDIR' in reason, 'Nested Bash reports the failed save')
        keys(b'\x0f', 'expand nested capture'); settle()
        body = card(label, '$ Bash(cat capture.txt)', reply)
        child, _ = body.split('Output to model', 1)
        failed_preview(label, child, True, reason)
        keys(b'\x0f', 'collapse nested capture'); settle()
    finally:
        temp.unlink(missing_ok=True)
        parked.rename(temp)

    # Only blank lines follow this oversized line, so Pi must keep its partial tail.
    original = ('long-part-' * 6000 + 'SINGLE-LINE-END\n\n\n').encode()
    (workspace / 'long.txt').write_bytes(original)
    result = request('Save a partial line after recovery', {'calls': [tool('bash', command='cat long.txt')]})[-1]['result']
    details = result['details']
    saved = Path(details['fullOutputPath'])
    check(details['truncation']['lastLinePartial'] and '[Showing last ' in result['content'][0]['text']
          and 'SINGLE-LINE-END\n\n' in result['content'][0]['text'],
          'Stock Bash retains the oversized line tail followed by blank lines')
    check('fullOutputError' not in details and saved.parent == temp and saved.read_bytes() == original,
          'The restored temp directory contains the exact untruncated output')
    def check_recovery(body, label):
        compact = ''.join(body.split())
        check(compact.count('SINGLE-LINE-END') == 1 and compact.count('Truncatedcapture·') == 1
              and compact.index('SINGLE-LINE-END') < compact.index('Truncatedcapture·')
              and ''.join(str(saved).split()) in compact and '[Showing' not in compact and 'Couldnotsave' not in compact,
              label + ' shows the long line ending followed by its single saved path')

    check_recovery(card('Recovered capture collapsed', '$ Bash(cat long.txt)', 'AUDIT-DONE'), 'Collapsed')
    keys(b'\x0f', 'expand the recovered long line'); settle()
    snap('Recovered capture expanded')
    # The expanded line fills multiple screens; the visible last page contains its tail.
    check_recovery(transcript().rsplit('AUDIT-DONE', 1)[0], 'Expanded')
    keys(b'\x0f', 'restore collapsed tool view'); settle()

def pi_compat_case():
    bash_capture_case()
    # A 1×1 red PNG with no fixture file to stage.
    image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC')
    (ROOT/'workspace/pixel.png').write_bytes(image)
    result = request('Read image with a text-only model', {'calls': [tool('read', path='pixel.png')]})[-1]
    check(result['toolName'] == 'read' and not result['isError']
          and (result['result'].get('details') or {}).get('imageUnsupportedByModel') == model,
          'Real Read identifies the text-only model in its result')
    warning = f'[{model} does not support images; it saw a placeholder instead]'
    check(warning in view() and 'Read image file [image/png]' not in view(), 'Collapsed Read displays the image warning')
    snap('Read image collapsed')
    keys(b'\x0f', 'expand Read'); settle()
    check(warning in view() and 'Read image file [image/png]' in view(), 'Expanded Read retains the warning and shows the result')
    snap('Read image expanded')

    def check_syntax(marker, verb):
        source = f'const {marker} = 101;'
        row = next((y for y, line in enumerate(journey.screen.display) if source in line), None)
        check(row is not None, f'{verb} displays the TypeScript diff line')
        offset = journey.screen.display[row].index(source)
        check(journey.screen.buffer[row][offset].fg == tone('syntaxKeyword'), f'{verb} uses the theme syntax keyword color')
        check(journey.screen.buffer[row][offset + len('const ')].fg == CODEX_FG, f'{verb} uses theme text for an unscoped token')

    request('Write TypeScript fixture', {'calls': [tool('write', path='probe.ts', content='const unscopedWrite = 101;\n')]})
    check_syntax('unscopedWrite', 'Write')
    request('Edit TypeScript fixture', {'calls': [tool('edit', path='probe.ts', edits=[{'oldText': 'unscopedWrite', 'newText': 'unscopedEdit'}])]})
    check_syntax('unscopedEdit', 'Edit')
    check((ROOT/'workspace/probe.ts').read_text() == 'const unscopedEdit = 101;\n', 'Write and Edit save the expected TypeScript bytes')

    if MODE == 'fullscreen':
        request('Overflow the fullscreen viewport', {'reply': '\n\n'.join(f'Scrollbar line {i}' for i in range(100))})
        edge = [journey.screen.buffer[y][journey.screen.columns - 1] for y in range(journey.screen.lines)]
        track_colors = {cell.fg for cell in edge if cell.data == '│'}
        thumb_colors = {cell.fg for cell in edge if cell.data in ('┃', '█')}
        check(track_colors == {'2c2c31'}, 'Fullscreen scrollbar track uses the codex-pi user background color')
        check(thumb_colors == {'6c6c74'}, 'Fullscreen scrollbar thumb uses the brighter codex-pi dim color')

def run():
    installed_package = journey.install(host, package)
    start()
    check((b'\x1b[?1049h' in journey.raw) == (MODE == 'fullscreen'), 'Terminal uses the requested screen mode')
    check('Codex profile' in view() and 'Claude Code v' not in view(), 'Installed Codex package renders the Codex header')
    themes = [event['data'] for event in records() if event['type'] == 'themes'][-1]
    external_themes = [theme for theme in themes if theme['name'] not in ('dark', 'light')]
    check(external_themes == [{'name': 'codex-pi', 'path': str(installed_package/'themes/codex-pi.json')}],
          'The installed package supplies the only external theme')
    if '--controls' in sys.argv:
        control_case(); stop()
        return True
    if PI_COMPAT:
        pi_compat_case(); stop()
        verify_pi_170(journey, 'Codex profile')
        return True
    command_availability('startup')
    footer = next((line for line in journey.screen.display if 'Context' in line and 'workspace' in line), '')
    check('faux-1' in footer, 'Footer displays the active model, directory and context')
    composer('startup')
    for width in [40,80,140]:
        resize(width);composer('width-'+str(width))
    select_theme('light');composer('light theme',None)
    select_theme('codex-pi');composer('codex-pi theme')
    output_padding_case()
    markdown='# USER-HEADING\n\n- user list\n  - nested list\n\n| left | right |\n| --- | --- |\n| A | B |\n\n```ts\nconst literal = "<tag>";\n```\n\n> quoted user text\n\n**bold** _italic_ [link](https://example.invalid)'
    reply = ('# REPLY-HEADING\n\n1. first item\n   - child item\n\n```ts\nconst answer = 42;\n```\n\n'
             '```\nREPLY-PLAIN-CODE\n```\n\n| left | right |\n| --- | --- |\n| C | D |\n\n> quoted reply text')
    (ROOT/'plan.json').write_text(json.dumps({'reply':reply}))
    n=sum(e['type']=='agent_settled' for e in records())
    keys(b'\x15\x1b[200~'+markdown.encode()+b'\x1b[201~\r','paste representative Markdown')
    wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'Markdown settled');settle()
    check(markdown in json.dumps([e['data'] for e in records() if e['type']=='request'][-1],ensure_ascii=False).replace('\\n','\n').replace('\\"','"'),'Model receives the original user Markdown')
    sessions_text='\n'.join(p.read_text() for p in (ROOT/'sessions').rglob('*.jsonl'))
    check(json.dumps(markdown)[1:-1] in sessions_text and json.dumps(reply)[1:-1] in sessions_text,'Session preserves exact user and assistant Markdown')
    check('REPLY-HEADING' in view() and 'const answer = 42;' in view(),'Complex reply Markdown renders in the real TUI')
    snap('Markdown transcript')
    check_style('REPLY-PLAIN-CODE', CODEX_FG)
    # Native fork and resume selectors replace the active session.
    n=sum(e['type']=='session_start' for e in records());command('/fork');settle();snap('fork selector')
    keys(b'\r','choose native fork message');wait(lambda:sum(e['type']=='session_start' for e in records())>n,'fork session');settle()
    keys(b'\x03','clear multiline fork prefill');settle();replacement_checks('fork')
    request('Fork followup',{'reply':'FORK-FOLLOWUP'})
    native_resume('native resume');replacement_checks('resume')
    # Actual file execution keeps full display across reload and session replacement.
    data='alpha\nbeta\ngamma\ndelta\nepsilon\n'
    result=request('Write before reload',{'calls':[tool('write',path='proof.txt',content=data)]})
    check((ROOT/'workspace/proof.txt').read_text()==data,'Real write preserves all bytes')
    check('Added' in view() and 'alpha' in view(),'New file displays Added and diff preview')
    reload();command_availability('reload')
    result=request('Overwrite after reload',{'calls':[tool('write',path='proof.txt',content='replacement\n')]})
    check((ROOT/'workspace/proof.txt').read_text()=='replacement\n','Overwrite changes actual file')
    check('Edited' in view() and 'replacement' in view(),'Overwrite displays Edited and diff preview')
    label='full'
    (ROOT/'workspace/pair.txt').write_text('before\n')
    result=request(label+' tools',{'calls':[tool('write',path='pair.txt',content='WRITE-PAIR-'+label+'\n'),tool('edit',path='pair.txt',edits=[{'oldText':'WRITE-PAIR','newText':'EDIT-PAIR'}]),tool('bash',command='printf "BASH-PAIR-'+label+'\\n"'),tool('codemode',code='text(await tools.read({path:"pair.txt"}));')],'reply':'PAIR-DONE-'+label})
    check((ROOT/'workspace/pair.txt').read_text()=='EDIT-PAIR-'+label+'\n','Actual write and edit preserve expected bytes')
    check(all(not r.get('isError') for r in result[-4:]),'All four real tools succeed')
    snap('full collapsed tools')
    write_card=view().split('~ Edited pair.txt')[-2]
    check('WRITE-PAIR-full' in write_card,'Write keeps full body preview')
    keys(b'\x0f','Full tools Ctrl+O');settle();snap('full expanded tools')
    section=view().split(label+' tools')[-1]
    check('(+1 -1)' in section and 'Bash(' in section and '@ Read pair.txt' in section,'Full edit line stats, Bash and native codemode child renderer are visible')
    keys(b'\x0f','Full tools Ctrl+O collapse');settle()
    request('Full thinking',{'thinking':'FULL-THINKING-FIRST\n'+'all reasoning is preserved. '*20+'\nFULL-THINKING-LAST','reply':'THINKING-PAIR-DONE'})
    check('FULL-THINKING-LAST' in view(),'Full Thinking remains visible')
    command('/new');settle(1)
    # Large and control-character writes must keep disk bytes while reporting display limits.
    (ROOT/'workspace/large.txt').write_text('old\n'*4002)
    result=request('Large diff unavailable',{'calls':[tool('write',path='large.txt',content='new\n'*4002)]})
    check((ROOT/'workspace/large.txt').read_text()=='new\n'*4002,'Large write preserves all bytes')
    keys(b'\x0f','expand large diff');settle();check('Diff unavailable' in view(),'Large write explicitly reports unavailable diff');keys(b'\x0f','collapse large diff')
    control_case()
    # Bash command and truncation branches use real command execution.
    long_command='printf "BASH-LONG-MARKER\\n" # '+'long-comment '*35
    request('Long Bash command',{'calls':[tool('bash',command=long_command)]});snap('long bash preview')
    request('Multiline Bash command',{'calls':[tool('bash',command='printf "MULTILINE-FIRST\\n"\nprintf "MULTILINE-LAST\\n"') ]});check('MULTILINE-FIRST' in view(),'Multiline Bash output is visible')
    request('Truncated Bash output',{'calls':[tool('bash',command='for i in $(seq 1 2500); do printf "line-%s\\n" "$i"; done') ]});keys(b'\x0f','expand truncated bash');settle();snap('truncated bash')
    check('truncat' in view().lower() or 'full output' in view().lower(),'Truncated Bash includes output note');keys(b'\x0f','collapse truncated bash')
    # Escape cancellation must stop an independent real Bash before its delayed side effect.
    (ROOT/'plan.json').write_text(json.dumps({'calls':[tool('bash',command='printf BEGIN-CANCEL; sleep 10; printf forbidden > cancelled.txt')]}))
    event_start=len(records())
    n=sum(e['type']=='agent_settled' for e in records());command('Cancel independent Bash')
    wait(lambda:bash_output_started(records()[event_start:],'BEGIN-CANCEL'),'real Bash output started');keys(b'\x1b','Escape real Bash');wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'Bash cancelled');settle()
    check(not (ROOT/'workspace/cancelled.txt').exists(),'Cancelled Bash has no delayed file side effect')
    aborted=[e['data'] for e in records() if e['type']=='tool_execution_end' and e['data']['toolName']=='bash'][-1]
    check(aborted.get('isError') and 'Command aborted' in json.dumps(aborted['result']['content']),'Independent Bash reports actual abort result')
    check('cancelled.txt) · interrupted' in view(),'Cancellation shows the interrupted Bash title');snap('independent interruption')
    command('/new'); settle(1);command_availability('new session')
    check(json.loads((ROOT/'agent/settings.json').read_text())['theme']=='codex-pi','Saved theme remains after reload/new')
    # Keep the extension entry available while deliberately corrupting Pi settings.
    stop()
    save_settings({**settings, 'theme': 'codex-pi'})
    journey.cli += ['-e', str(installed_package)]
    start()
    # Prefix, shell and untrusted project configuration through real model tool execution.
    shell=ROOT/'shell-wrapper'
    shell.write_text('#!/bin/sh\nexport AUDIT_SHELL=wrapper\nexec /bin/bash "$@"\n'); shell.chmod(0o755)
    active={**settings,'theme':'codex-pi','shellPath':str(shell),'shellCommandPrefix':'export AUDIT_PREFIX=global'}
    save_settings(active); reload()
    calls=[tool('bash',command='printf "%s:%s" "$AUDIT_PREFIX" "$AUDIT_SHELL"'),tool('read',path='read.txt')]
    result=request('Check settings',{'calls':calls})
    check('global:wrapper' in json.dumps(result[-2:]),'Real bash inherits prefix/shell; untrusted prefix excluded')
    check('READ-CONTENT' in json.dumps([r for r in result[-2:] if r['toolName']=='read']),'Real read returns fixture')
    # Broken configuration must fail closed, without exposing content or creating a marker.
    (ROOT/'agent/settings.json').write_text('{broken')
    actions.append({'seed':'Malformed global settings'}); reload()
    result=request('Reject malformed settings',{'calls':[tool('bash',command='printf bad > forbidden.txt'),tool('read',path='read.txt')]})
    failed=result[-2:]
    check(all(x.get('isError') for x in failed),'Both bash and read fail closed')
    check('Cannot load global execution settings' in json.dumps(failed),'English error explains settings rejection')
    check(not (ROOT/'workspace/forbidden.txt').exists(),'Rejected bash did not write marker')
    check('READ-CONTENT' not in json.dumps(failed),'Rejected read did not expose contents')
    save_settings(active)
    result=request('Keep error until reload',{'calls':[tool('bash',command='printf still-blocked > forbidden.txt')]})
    check(result[-1].get('isError') and not (ROOT/'workspace/forbidden.txt').exists(),'Error snapshot remains until reload')
    reload()
    result=request('Repair configuration',{'calls':calls})
    check('global:wrapper' in json.dumps(result[-2:]) and not result[-1].get('isError'),'Repair and reload restore execution')
    # Trusted project errors and permissions must fail closed, then refresh on reload.
    stop();start(['--approve'])
    project=ROOT/'workspace/.pi/settings.json'
    for damaged in ['syntax','permissions']:
        if damaged=='syntax': project.write_text('{broken')
        else: project.write_text('{}');project.chmod(0)
        try:
            reload()
            result=request('Reject project '+damaged,{'calls':[tool('bash',command='printf forbidden > project-forbidden.txt'),tool('read',path='read.txt')]})
            check(all(r.get('isError') for r in result[-2:]) and not (ROOT/'workspace/project-forbidden.txt').exists(),'Trusted project '+damaged+' blocks read/bash without file side effect')
        finally:
            project.chmod(0o600)
        project.write_text(json.dumps({'shellCommandPrefix':'export AUDIT_PREFIX=project'}))
        result=request('Project snapshot stays rejected',{'calls':[tool('read',path='read.txt')]})
        check(result[-1].get('isError'),'Project error remains cached before reload')
        reload();result=request('Project repaired '+damaged,{'calls':calls})
        check('project:wrapper' in json.dumps(result[-2:]) and not result[-1].get('isError'),'Project '+damaged+' repair and reload restore real execution')
    stop();start(['--no-approve'])
    result=request('Trust transition excludes project',{'calls':calls})
    check('global:wrapper' in json.dumps(result[-2:]),'Restart with no approval excludes previously trusted project prefix')
    # Cache pressure and inspector keyboard navigation use real QuickJS/read execution.
    cache='CACHE-SOURCE-FIRST\n'+'\n'.join('cache-line-'+str(i)+':'+('x'*60) for i in range(600))
    (ROOT/'workspace/cache.txt').write_text(cache)
    request('Codemode cache pressure',{'calls':[tool('codemode',code='for(let i=0;i<100;i++) await tools.read({path:"cache.txt"}); text("CACHE-BUDGET-DONE");')]})
    command('/inspect');wait(lambda:'Codemode inspector' in view(),'cache inspector');settle()
    check('Raw result unavailable' in view(),'Over 4MiB evicts oldest captured result')
    keys(b'\x1b[B'*99,'Down 99');settle();check('CACHE-SOURCE-FIRST' in view(),'Newest captured result remains available')
    keys(b'\x1b[6~'*3,'PgDn 3');settle();check('CACHE-SOURCE-FIRST' not in view() and 'cache-line-' in view(),'Inspector pages selected result down')
    keys(b'\x1b[5~'*3,'PgUp 3');settle();check('CACHE-SOURCE-FIRST' in view(),'Inspector pages selected result back')
    keys(b'\x1b[Z','Shift+Tab');settle();check('[Output]' in view() and 'CACHE-BUDGET-DONE' in view(),'Reverse tab selects model output')
    keys(b'\x1b','close inspector');settle()
    command('/new');settle();native_resume('codemode native resume')
    request('Codemode resumed followup',{'reply':'CODEMODE-CONTEXT-DONE'})
    check('CACHE-BUDGET-DONE' in json.dumps([e for e in records() if e['type']=='request'][-1]),'Native resumed subsequent model request includes saved codemode result')
    command('/inspect');wait(lambda:'Codemode inspector' in view(),'resumed inspector');settle()
    check('Raw result unavailable' in view(),'Native resume rebuilds saved metadata without raw cache');keys(b'\x1b','close resumed inspector');settle()
    command('/tree');settle();snap('native tree selector');keys(b'\x1b[A','choose previous tree entry');keys(b'\r','navigate native tree');settle()
    if 'Summarize branch?' in view():keys(b'\r','choose No summary');settle()
    check('Navigated to selected point' in view(),'Native tree selector navigates the session history')
    keys(b'\x03','clear tree prefill');settle();request('Tree followup',{'reply':'TREE-CONTEXT-DONE'})
    check('CACHE-BUDGET-DONE' in json.dumps([e for e in records() if e['type']=='request'][-1]),'Native tree followup carries codemode context')
    # Thinking, title and actual keyboard cancellation. No timer internals are called.
    command('/new'); settle(1)
    thinking = ('Audit reasoning\n\n```ts\nconst fenceStart = 1;\n\nconst fenceEnd = 2;\n```\n\n'
                + 'Reasoning remains visible during streamed output. ' * 32 + '\n\nLAST-THINKING-LINE')
    (ROOT/'plan.json').write_text(json.dumps({'thinking':thinking,'reply':'THINKING-DONE'}))
    n=sum(e['type']=='agent_settled' for e in records()); start_offset=len(journey.raw); command('Stream reasoning')
    wait(lambda:'Reasoning remains' in view(),'streaming-thinking')
    check(sum(e['type']=='agent_settled' for e in records()) == n, 'Thinking quote rails are observed during the live stream')
    check_thinking_rails('streaming Thinking rails')
    keys(b'\x14','Ctrl+T hide during stream')
    wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'thinking-settled'); settle()
    check('Thinking...' in view() and 'LAST-THINKING-LINE' not in view(),'Completion retains hidden thinking choice')
    check_style('Thinking...', THINKING_FG, italic=True)
    keys(b'\x14','Ctrl+T expand completed thinking'); wait(lambda:'LAST-THINKING-LINE' in view(),'thinking-expanded')
    check_thinking_rails('settled Thinking rails', complete=True)
    if MODE == 'fullscreen':
        check(b'\x1b[?1006h' in journey.raw, 'Fullscreen enables SGR mouse reporting')
        click_thinking('│ Audit reasoning', 'click quoted Thinking body')
        wait(lambda: 'Thinking...' in view() and 'LAST-THINKING-LINE' not in view(), 'mouse collapses Thinking')
        click_thinking('Thinking...', 'click hidden Thinking label')
        wait(lambda: 'LAST-THINKING-LINE' in view(), 'mouse expands Thinking')
        check_thinking_rails('mouse-restored Thinking rails', complete=True)
    all_titles=titles(journey.raw[start_offset:]); animated=[t for t in all_titles if t.decode('utf8').startswith(tuple('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'))]
    check(len(set(animated))>=2,'OSC title changes during actual streaming')
    check(all_titles and all_titles[-1].decode('utf8').startswith('π'),'Settled title returns to static')
    at=len(journey.raw); settle(.5); check(not titles(journey.raw[at:]),'Settled title remains static')
    session_files=list((ROOT/'sessions').rglob('*.jsonl')); session_file=max(session_files,key=lambda p:p.stat().st_mtime)
    stop(); start(['--session',str(session_file)])
    check('LAST-THINKING-LINE' in view() and 'Thinking' in view(),'Fresh CLI restores thinking text')
    check_thinking_rails('reopened Thinking rails', complete=True)
    request('Followup after resume',{'reply':'RESUME-FOLLOWUP'})
    check('LAST-THINKING-LINE' in json.dumps([e for e in records() if e['type']=='request'][-1]),'Resumed subsequent request carries thinking history')
    (ROOT/'plan.json').write_text(json.dumps({'thinking':'CANCEL-THINKING-FIRST\n'+thinking*10,'reply':'SHOULD-NOT-FINISH'}))
    n=sum(e['type']=='agent_settled' for e in records()); command('Cancel reasoning')
    wait(lambda:'CANCEL-THINKING-FIRST' in view(),'second-stream')
    keys(b'\x1b','Escape cancel stream'); wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'cancelled'); settle()
    snap('cancelled-thinking'); check(titles()[-1].decode('utf8').startswith('π'),'Cancellation restores static title')
    at=len(journey.raw); settle(.5); check(not titles(journey.raw[at:]),'Cancelled title remains static')
    command('/new');settle();native_resume('cancelled thinking native resume')
    check('CANCEL-THINKING-FIRST' in view(),'Native resume retains cancelled partial thinking')
    keys(b'\x14','hide restored cancelled thinking');settle();snap('cancelled thinking hidden');keys(b'\x14','expand restored cancelled thinking');settle()
    request('Errored reasoning',{'thinking':'ERROR-THINKING-FIRST\n'+'errored reasoning. '*12+'\nERROR-THINKING-LAST','reply':'ERROR-REPLY','error':True})
    command('/new');settle();native_resume('errored thinking native resume')
    check('ERROR-THINKING-LAST' in view(),'Native resume retains errored thinking text')
    request('Post-error reasoning',{'thinking':'COMPACTION-THINKING-FIRST\ncomplete reasoning\nCOMPACTION-THINKING-LAST','reply':'PRE-COMPACT-DONE'})
    command('/compact');wait(lambda:'Compacted' in view() or 'compacted' in view(),'native compaction');settle()
    check('COMPACTION-THINKING-LAST' in view(),'Compaction keeps recent full thinking')
    keys(b'\x14','hide thinking after compaction');settle();check('COMPACTION-THINKING-LAST' not in view(),'Thinking toggle works after compaction');keys(b'\x14','expand thinking after compaction');settle()
    stop()
    return all(assertion['passed'] for assertion in assertions)

passed = False
try:
    passed = run()
except Exception:
    (EVIDENCE/'failure.txt').write_text(traceback.format_exc())
    print(traceback.format_exc())
finally:
    passed = journey.finish(passed)
sys.exit(0 if passed else 1)
