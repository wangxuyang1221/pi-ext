"""Real CLI/PTy acceptance. Substitute the model boundary; keep tools and storage real."""
import codecs, errno, fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, time, traceback
from pathlib import Path
import pyte

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[3]
MODE = sys.argv[1] if len(sys.argv) > 1 else 'regular'
EVIDENCE = REPO / '.tmp/test-results' / ('codex-ui-cli-' + MODE + '-' + str(time.time_ns()))
EVIDENCE.mkdir(parents=True)
ROOT = Path(tempfile.mkdtemp(prefix='scratch-', dir=EVIDENCE))
for name in ['home', 'agent', 'workspace', 'sessions', 'tmp', 'cache', 'config', 'data', 'state']:
    (ROOT / name).mkdir()
settings = dict(quietStartup=True, defaultProjectTrust='never', theme='codex-pi', compaction={'enabled': False,'keepRecentTokens':128}, retry={'enabled': False}, cacheWarming='off')
(ROOT/'agent/themes').mkdir()
shutil.copyfile(REPO/'themes/codex-pi.json', ROOT/'agent/themes/codex-pi.json')
(ROOT/'agent/settings.json').write_text(json.dumps(settings))
(ROOT/'workspace/.pi').mkdir()
(ROOT/'workspace/.pi/settings.json').write_text(json.dumps({'shellCommandPrefix': 'export AUDIT_PREFIX=untrusted'}))
(ROOT/'workspace/read.txt').write_text('READ-CONTENT\n')
(ROOT/'plan.json').write_text(json.dumps({'reply': 'AUDIT-DONE'}))
env = {k:v for k,v in os.environ.items() if k in ['PATH', 'LANG', 'LC_ALL', 'TZ']}
env.update(HOME=str(ROOT/'home'), TMPDIR=str(ROOT/'tmp'), PI_CODING_AGENT_DIR=str(ROOT/'agent'), AUDIT_ROOT=str(ROOT), TERM='xterm-256color', COLORTERM='truecolor', PI_OFFLINE='1', PI_TELEMETRY='0', PI_SKIP_VERSION_CHECK='1', PYTHONDONTWRITEBYTECODE='1')
for kind in ['CACHE','CONFIG','DATA','STATE']: env['XDG_'+kind+'_HOME'] = str(ROOT/kind.lower())
cli = ['node', str(REPO/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--offline', '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--tools', '+codemode', '--session-dir', str(ROOT/'sessions'), '--provider', 'faux', '--model', 'faux-1', '-e', str(REPO/'extensions/codex-ui/dist/index.js'), '-e', str(BASE/'model-provider.ts')]
actions, snapshots, assertions, processes = [], {}, [], []
pid, fd, status = None, None, None
raw = bytearray()
def interrupt_owned_driver(signum, _frame):
    raise KeyboardInterrupt('Owned driver interrupted by signal '+str(signum))
for owned_signal in [signal.SIGTERM,signal.SIGHUP]:signal.signal(owned_signal,interrupt_owned_driver)

def records():
    p = ROOT/'events.jsonl'
    return [json.loads(s) for s in p.read_text().splitlines()] if p.exists() else []

def check(condition, message):
    assertions.append({'assertion':message,'passed':bool(condition)})
    if not condition: raise AssertionError(message)

def start(extra=None):
    global pid, fd, status, screen, stream, decoder, raw
    raw = bytearray(); status = None
    args = cli + ['--tui-mode', MODE] + (extra or [])
    before = sum(e['type']=='resources_discover' for e in records())
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT/'workspace'); os.execvpe(args[0], args, env)
    processes.append({'pid':pid,'command':args})
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 60, 140, 0, 0))
    screen = pyte.Screen(140,60); stream=pyte.Stream(screen); decoder=codecs.getincrementaldecoder('utf8')('replace')
    wait(lambda:sum(e['type']=='resources_discover' for e in records())>before,'ready')
    settle(.5); snap('startup-'+str(len(processes)))

def view(): return '\n'.join(x.rstrip() for x in screen.display)
def snap(label):
    rows=[]
    for y in range(screen.lines):
        runs=[]
        for x in range(screen.columns):
            c=screen.buffer[y][x]
            if runs and runs[-1][2:]==[c.fg,c.bg]: runs[-1][1]=x+1
            else: runs.append([x,x+1,c.fg,c.bg])
        rows.append(runs)
    snapshots[label]={'text':view(),'size':[screen.columns,screen.lines],'styleRuns':rows}
def pump():
    global status
    if select.select([fd],[],[],.04)[0]:
        try: data=os.read(fd,65536)
        except OSError as e:
            if e.errno!=errno.EIO: raise
            data=b''
        raw.extend(data)
        if b'\x1b[6n' in data: os.write(fd,b'\x1b[1;1R')
        stream.feed(decoder.decode(data))
    if status is None:
        done,value=os.waitpid(pid,os.WNOHANG)
        if done: status=value
def settle(seconds=.35):
    end=time.monotonic()+seconds
    while time.monotonic()<end: pump()
def wait(predicate,label,seconds=30):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        pump()
        if predicate(): snap(label); return
        if status is not None: break
    snap('failed-'+label)
    raise AssertionError('Failed: '+label+'\n'+view())
def keys(data,label):
    actions.append({'action':label,'bytes':data.hex(),'at':time.monotonic(),'rawOffset':len(raw)})
    os.write(fd,data)
def command(text): keys(b'\x15'+text.encode()+b'\r',text)
def titles(data=None): return re.findall(rb'\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)',raw if data is None else data)
def request(label,plan):
    (ROOT/'plan.json').write_text(json.dumps(plan)); actions.append({'seed':plan,'label':label})
    n=sum(e['type']=='agent_settled' for e in records()); command(label)
    wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,label+' settled')
    settle(); snap(label)
    return [e['data'] for e in records() if e['type']=='tool_execution_end']
def tool(name,**args): return {'name':name,'arguments':args}
def reload():
    n=sum(e['type']=='session_start' for e in records()); command('/reload')
    wait(lambda:sum(e['type']=='session_start' for e in records())>n,'reloaded'); settle()
def save_settings(value):
    (ROOT/'agent/settings.json').write_text(json.dumps(value)); actions.append({'settingsSeed':value})
def composer(label,expected_bg='484848'):
    keys(b'\x15COMPOSER-INPUT',label+' input'); settle()
    row=next(y for y,line in enumerate(screen.display) if 'COMPOSER-INPUT' in line)
    colors={screen.buffer[row][x].bg for x in range(screen.columns)}
    check(len(colors)==1 and 'default' not in colors,label+' paints the complete composer row')
    check(all({screen.buffer[y][x].bg for x in range(screen.columns)}==colors for y in [row-1,row+1]),label+' paints the blank padding rows')
    if expected_bg:check(colors=={expected_bg},label+' uses the selected theme background')
    else:check(colors!={'484848'},label+' changes composer background from codex-pi')
    snap(label); keys(b'\x15',label+' clear')
def resize(width):
    fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',60,width,0,0));screen.resize(60,width);os.kill(pid,signal.SIGWINCH);settle()
    actions.append({'resize':[width,60]})
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
        if any(line.startswith('→') and re.search(r'\b'+re.escape(name)+r'\s*$',line) for line in screen.display): break
        keys(b'\x1b[B','next theme');settle(.1)
    else: raise AssertionError('Theme choice not found: '+name+'\n'+view())
    snap('select theme '+name);keys(b'\r','save theme '+name);settle();keys(b'\x1b','close settings');settle()
    check(json.loads((ROOT/'agent/settings.json').read_text())['theme']==name,'Native settings saves '+name)
def control_case():
    (ROOT/'workspace/controls.txt').write_bytes(b'old\r\n')
    controls='CONTROL-FIRST\x1b[2J\x1b[H\x1b]0;source-must-not-set-title\x07CONTROL-LAST\r\n'
    offset=len(raw)
    request('Control character diff',{'calls':[tool('write',path='controls.txt',content=controls)]})
    keys(b'\x0f','expand control character diff');settle()
    check((ROOT/'workspace/controls.txt').read_bytes()==controls.encode(),'Display sanitization preserves original disk bytes')
    check('CONTROL-FIRSTCONTROL-LAST' in view(),'Real diff displays text surrounding source terminal controls')
    check(all(b'source-must-not-set-title' not in title for title in titles(raw[offset:])),'Source OSC cannot change the terminal title')
    snap('sanitized control diff');keys(b'\x0f','collapse control character diff');settle()
def stop():
    global fd
    if status is None:
        command('/quit'); wait(lambda:status is not None,'exit')
    check(os.waitstatus_to_exitcode(status)==0,'CLI exits normally')
    (EVIDENCE/f'terminal-{len(processes)}.ansi').write_bytes(raw)
    os.close(fd); fd=None
    try: os.kill(pid,0); stopped=False
    except ProcessLookupError: stopped=True
    processes[-1]['stopped']=stopped; check(stopped,'Owned PID stopped')
    try: os.killpg(pid,0);group_stopped=False
    except ProcessLookupError:group_stopped=True
    processes[-1]['groupStopped']=group_stopped;check(group_stopped,'Owned process group stopped')

passed=False
try:
    start()
    if '--controls' in sys.argv:
        control_case();stop();passed=True
        raise SystemExit(0)
    command_availability('startup')
    composer('startup')
    for width in [40,80,140]:
        resize(width);composer('width-'+str(width))
    select_theme('light');composer('light theme',None)
    select_theme('codex-pi');composer('codex-pi theme')
    markdown='# USER-HEADING\n\n- user list\n  - nested list\n\n| left | right |\n| --- | --- |\n| A | B |\n\n```ts\nconst literal = "<tag>";\n```\n\n> quoted user text\n\n**bold** _italic_ [link](https://example.invalid)'
    reply='# REPLY-HEADING\n\n1. first item\n   - child item\n\n```ts\nconst answer = 42;\n```\n\n| left | right |\n| --- | --- |\n| C | D |\n\n> quoted reply text'
    (ROOT/'plan.json').write_text(json.dumps({'reply':reply}))
    n=sum(e['type']=='agent_settled' for e in records())
    keys(b'\x15\x1b[200~'+markdown.encode()+b'\x1b[201~\r','paste representative Markdown')
    wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'Markdown settled');settle()
    check(markdown in json.dumps([e['data'] for e in records() if e['type']=='request'][-1],ensure_ascii=False).replace('\\n','\n').replace('\\"','"'),'Model receives the original user Markdown')
    sessions_text='\n'.join(p.read_text() for p in (ROOT/'sessions').rglob('*.jsonl'))
    check(json.dumps(markdown)[1:-1] in sessions_text and json.dumps(reply)[1:-1] in sessions_text,'Session preserves exact user and assistant Markdown')
    check('REPLY-HEADING' in view() and 'const answer = 42;' in view(),'Complex reply Markdown renders in the real TUI')
    snap('Markdown transcript')
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
    n=sum(e['type']=='agent_settled' for e in records());command('Cancel independent Bash')
    wait(lambda:'BEGIN-CANCEL' in view(),'real Bash started');keys(b'\x1b','Escape real Bash');wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'Bash cancelled');settle()
    check(not (ROOT/'workspace/cancelled.txt').exists(),'Cancelled Bash has no delayed file side effect')
    aborted=[e['data'] for e in records() if e['type']=='tool_execution_end' and e['data']['toolName']=='bash'][-1]
    check(aborted.get('isError') and 'Command aborted' in json.dumps(aborted['result']['content']),'Independent Bash reports actual abort result')
    check('Interrupted' in view() or 'Command aborted' in view(),'Cancellation has an explicit terminal result');snap('independent interruption')
    command('/new'); settle(1);command_availability('new session')
    check(json.loads((ROOT/'agent/settings.json').read_text())['theme']=='codex-pi','Saved theme remains after reload/new')
    # Prefix, shell and untrusted project configuration through real model tool execution.
    shell=ROOT/'shell-wrapper'
    shell.write_text('#!/bin/sh\nexport AUDIT_SHELL=wrapper\nexec /bin/bash "$@"\n'); shell.chmod(0o755)
    active={**settings,'shellPath':str(shell),'shellCommandPrefix':'export AUDIT_PREFIX=global'}
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
        reload()
        result=request('Reject project '+damaged,{'calls':[tool('bash',command='printf forbidden > project-forbidden.txt'),tool('read',path='read.txt')]})
        check(all(r.get('isError') for r in result[-2:]) and not (ROOT/'workspace/project-forbidden.txt').exists(),'Trusted project '+damaged+' blocks read/bash without file side effect')
        project.chmod(0o600);project.write_text(json.dumps({'shellCommandPrefix':'export AUDIT_PREFIX=project'}))
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
    thinking='**Audit reasoning**\n\n'+'Reasoning remains visible during streamed output. '*12+'\n\nLAST-THINKING-LINE'
    (ROOT/'plan.json').write_text(json.dumps({'thinking':thinking,'reply':'THINKING-DONE'}))
    n=sum(e['type']=='agent_settled' for e in records()); start_offset=len(raw); command('Stream reasoning')
    wait(lambda:'Reasoning remains' in view(),'streaming-thinking')
    keys(b'\x14','Ctrl+T hide during stream')
    wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'thinking-settled'); settle()
    check('Thinking...' in view() and 'LAST-THINKING-LINE' not in view(),'Completion retains hidden thinking choice')
    keys(b'\x14','Ctrl+T expand completed thinking'); wait(lambda:'LAST-THINKING-LINE' in view(),'thinking-expanded')
    all_titles=titles(raw[start_offset:]); animated=[t for t in all_titles if t.decode('utf8').startswith(tuple('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'))]
    check(len(set(animated))>=2,'OSC title changes during actual streaming')
    check(all_titles and all_titles[-1].decode('utf8').startswith('π'),'Settled title returns to static')
    at=len(raw); settle(.5); check(not titles(raw[at:]),'Settled title remains static')
    session_files=list((ROOT/'sessions').rglob('*.jsonl')); session_file=max(session_files,key=lambda p:p.stat().st_mtime)
    stop(); start(['--session',str(session_file)])
    check('LAST-THINKING-LINE' in view() and 'Thinking' in view(),'Fresh CLI restores thinking text')
    request('Followup after resume',{'reply':'RESUME-FOLLOWUP'})
    check('LAST-THINKING-LINE' in json.dumps([e for e in records() if e['type']=='request'][-1]),'Resumed subsequent request carries thinking history')
    (ROOT/'plan.json').write_text(json.dumps({'thinking':'CANCEL-THINKING-FIRST\n'+thinking*10,'reply':'SHOULD-NOT-FINISH'}))
    n=sum(e['type']=='agent_settled' for e in records()); command('Cancel reasoning')
    wait(lambda:'CANCEL-THINKING-FIRST' in view(),'second-stream')
    keys(b'\x1b','Escape cancel stream'); wait(lambda:sum(e['type']=='agent_settled' for e in records())>n,'cancelled'); settle()
    snap('cancelled-thinking'); check(titles()[-1].decode('utf8').startswith('π'),'Cancellation restores static title')
    at=len(raw); settle(.5); check(not titles(raw[at:]),'Cancelled title remains static')
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
    # Load the actual companion extensions for footer status combinations.
    env['UI_VERIFY_FOOTER']='1'
    start(['--provider','openai','--model','gpt-5.4','-e',str(REPO/'extensions/openai-fast-mode/dist/index.js'),'-e',str(REPO/'extensions/permissions/dist/index.js')])
    command('/fast on');settle()
    footer=next((line for line in screen.display if 'Context' in line and 'workspace' in line),'')
    check('gpt-5.4' in footer and 'fast' in footer and 'full access' in footer,'Footer combines actual model, directory, fast and permissions status')
    snap('companion footer combined');resize(60);snap('companion footer narrow');resize(140)
    command('/fast off');settle();command('/permissions default');settle();footer=next((line for line in screen.display if 'Context' in line and 'workspace' in line),'')
    check('fast' not in footer and 'full access' not in footer,'Footer removes Fast and full access status after disabling them')
    stop();passed=True
except Exception:
    (EVIDENCE/'failure.txt').write_text(traceback.format_exc())
    print(traceback.format_exc())
finally:
    if fd is not None:
        (EVIDENCE/f'terminal-{len(processes)}.ansi').write_bytes(raw)
        if status is None:
            try: os.killpg(pid,signal.SIGTERM)
            except ProcessLookupError: pass
            end=time.monotonic()+5
            while status is None and time.monotonic()<end: pump()
            if status is None:
                os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
        os.close(fd)
        processes[-1]['stopped']=subprocess.run(['kill','-0',str(pid)],capture_output=True).returncode!=0
        try:os.killpg(pid,0);group_stopped=False
        except ProcessLookupError:group_stopped=True
        processes[-1]['groupStopped']=group_stopped
    for name in ['agent','sessions','workspace']:
        shutil.copytree(ROOT/name,EVIDENCE/name)
    (EVIDENCE/'events.json').write_text(json.dumps(records(),ensure_ascii=False,indent=2))
    cleanup_safe=all(p.get('stopped') and p.get('groupStopped') for p in processes)
    if cleanup_safe:shutil.rmtree(ROOT)
    else:passed=False
    summary={'passed':passed,'mode':MODE,'scratch':str(ROOT),'scratchRemoved':not ROOT.exists(),'processes':processes,'actions':actions,'assertions':assertions,'screens':snapshots,'layer':'native CLI/PTy; offline model boundary; real tools/files/session'}
    (EVIDENCE/'journey.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    print(json.dumps({'passed':passed,'evidence':str(EVIDENCE)}))
sys.exit(0 if passed else 1)
