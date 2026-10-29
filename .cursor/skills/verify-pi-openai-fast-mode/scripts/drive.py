"""Verification fixture: real CLI/PTY commands with offline HTTP transport recording."""
import codecs, errno, fcntl, json, os, pty, select, shutil, signal, struct, sys, termios, time, traceback
from pathlib import Path
import pyte
repo = Path.cwd()
root, evidence = map(Path, sys.argv[1:3])
mode = sys.argv[3] if len(sys.argv) > 3 else 'full'
for name in ['workspace','sessions']:
    (root/name).mkdir(exist_ok=True)
(root/'agent/settings.json').write_text(json.dumps({'quietStartup':True,'defaultProjectTrust':'never','retry':{'enabled':False},'compaction':{'enabled':False},'cacheWarming':'off'}))
config = root/'agent/extensions/pi-openai-fast-mode/config.json'
records, checks, processes = [], [], []
current = None

def events():
    p=root/'events.jsonl'
    return [json.loads(s) for s in p.read_text().splitlines()] if p.exists() else []

def enabled(path=config):
    return json.loads(path.read_text()).get('enabled') if path.exists() else None

class Cli:
    def __init__(self,label,extra=[],child=None,entry=None):
        global current
        self.label=label; self.actions=[]; self.screens={}; self.file_states=[]; self.raw=bytearray(); self.status=None
        self.screen=pyte.Screen(150,50); self.stream=pyte.Stream(self.screen); self.decoder=codecs.getincrementaldecoder('utf-8')('replace')
        self.args=['node',str(repo/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--no-builtin-tools','--session-dir',str(root/'sessions'),'--provider','openai-codex','--model','gpt-7-unlisted','-e',str(entry or repo/'extensions/openai-fast-mode/dist/index.js'),'-e',str(repo/'.cursor/skills/verify-pi-openai-fast-mode/scripts/request-provider.ts'),*extra]
        env=dict(os.environ,TERM='xterm-256color')
        if child is not None:
            env.update(PI_SUBAGENT_PARENT='{}',PI_SUBAGENT_LAUNCH=json.dumps({'fast':child}))
        before=len(events())
        self.pid,self.fd=pty.fork()
        if self.pid==0:
            os.chdir(root/'workspace'); os.execvpe(self.args[0],self.args,env)
        current=self; processes.append(self.pid)
        (evidence/'owners.json').write_text(json.dumps({'driverPid':os.getpid(),'pids':processes}))
        fcntl.ioctl(self.fd,termios.TIOCSWINSZ,struct.pack('HHHH',50,150,0,0))
        self.wait(lambda:any(e['type']=='ready' and e['pid']==self.pid for e in events()[before:]),'ready')
        self.session=next(e['data']['sessionFile'] for e in reversed(events()) if e['type']=='ready' and e['pid']==self.pid)
    def view(self): return '\n'.join(line.rstrip() for line in self.screen.display)
    def pump(self):
        if select.select([self.fd],[],[],.05)[0]:
            try: data=os.read(self.fd,65536)
            except OSError as ex:
                if ex.errno != errno.EIO: raise
                data=b''
            self.raw.extend(data)
            if b'\x1b[6n' in data: os.write(self.fd,b'\x1b[1;1R')
            self.stream.feed(self.decoder.decode(data))
        if self.status is None:
            p,s=os.waitpid(self.pid,os.WNOHANG)
            if p: self.status=s
    def wait(self,pred,label):
        limit=time.monotonic()+25
        while time.monotonic()<limit:
            self.pump()
            if pred():
                self.screens[label]=self.view()
                project=root/'workspace/.pi/pi-openai-fast-mode/config.json'
                self.file_states.append({'label':label,'userConfig':config.read_text() if config.exists() else None,'projectConfig':project.read_text() if project.exists() else None})
                return
            if self.status is not None: break
        raise AssertionError(f'{self.label}: {label}\n{self.view()}')
    def send(self,text):
        self.actions.append({'text':text,'at':time.monotonic()}); os.write(self.fd,text.encode()+b'\r')
    def fast(self,value):
        self.send('/fast '+('on' if value else 'off'))
        self.wait(lambda:enabled() is value,'fast-'+str(value))
    def model(self,provider,id):
        n=len(events()); self.send('/model '+provider+'/'+id)
        self.wait(lambda:any(e['type']=='model' and e['data']['provider']==provider and e['data']['id']==id for e in events()[n:]),'model-'+provider+'-'+id)
    def request(self,text,tier,provider=None,id=None):
        n=len(events()); self.send(text)
        self.wait(lambda:any(e['type']=='settled' for e in events()[n:]),'settled-'+text)
        rows=[e['data'] for e in events()[n:] if e['type']=='request']
        assert len(rows)==1, f'{text}: expected one HTTP request, got {len(rows)}'
        actual=rows[0]['payload'].get('service_tier')
        checks.append({'label':text,'expectedTier':tier,'actualTier':actual,'provider':rows[0]['provider'],'payload':rows[0]['payload']})
        assert actual==tier, f'{text}: service_tier expected {tier!r}, got {actual!r}'
        if provider: assert rows[0]['provider']==provider
        if id: assert rows[0]['payload']['model']==id
        return rows[0]
    def close(self,graceful=True):
        global current
        if self.status is None and graceful:
            self.send('/quit'); self.wait(lambda:self.status is not None,'exited')
            assert os.waitstatus_to_exitcode(self.status)==0
        if self.status is None:
            os.killpg(self.pid,signal.SIGKILL); os.waitpid(self.pid,0)
        os.close(self.fd)
        try: os.kill(self.pid,0); raise AssertionError('Owned process still alive')
        except ProcessLookupError: pass
        (evidence/(self.label+'.ansi')).write_bytes(self.raw)
        records.append({'label':self.label,'pid':self.pid,'args':self.args,'session':getattr(self,'session',None),'actions':self.actions,'screens':self.screens,'fileStates':self.file_states,'processStopped':True})
        current=None

def interrupted(signum, _frame):
    raise InterruptedError(f'Verification interrupted by signal {signum}')

signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)

passed=False; failure=None
try:
    cli=Cli('root', ['--fast'])
    assert enabled() is True, '--fast must persist'
    cli.request('initial-priority','priority')
    if mode=='smoke':
        cli.close()
    else:
        for provider,id,tier in [('openai',id,'priority') for id in ['gpt-5.4','gpt-5.5','gpt-5.6','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-6-astra']]+[('openai','gpt-6-astra-unknown',None),('audit-other','gpt-6-astra',None),('openai-codex','gpt-6-sol','priority')]:
            cli.model(provider,id); cli.request('model-'+provider+'-'+id,tier,provider,id)
        cli.model('openai-codex','gpt-7-unlisted')
        cli.request('reject-fast','priority')
        cli.wait(lambda:'Retry to use standard mode' in cli.view(),'unsupported-warning')
        cli.request('standard-retry',None)
        cli.fast(False); cli.fast(True)
        cli.request('toggle-does-not-clear-rejection',None)
        cli.model('openai-codex','gpt-6-sol'); cli.request('other-model-after-rejection','priority')
        cli.request('ambiguous-error','priority'); cli.request('after-ambiguous-error','priority')
        cli.model('openai-codex','gpt-7-unlisted'); cli.request('return-to-rejected-model',None)
        assert enabled() is True
        cli.close()
        cli=Cli('root-restarted'); cli.request('new-session-restores-priority','priority')
        cli.fast(False); cli.close()
        cli=Cli('root-restarted-off'); cli.request('persisted-off',None); cli.close()
        # New operation combination: invalid command, reload, model switch and request.
        cli=Cli('novel-combination',['--fast']); before=config.read_bytes()
        cli.send('/fast on now'); cli.wait(lambda:'Usage: /fast [on|off|toggle]' in cli.view(),'invalid-usage')
        assert config.read_bytes()==before
        n=len(events()); cli.send('/reload'); cli.wait(lambda:any(e['type']=='ready' for e in events()[n:]),'reloaded')
        cli.model('openai','gpt-6-astra-unknown'); cli.request('novel-unmatched',None)
        cli.send('/fast toggle'); cli.wait(lambda:enabled() is False,'novel-toggle-off')
        cli.model('openai','gpt-6-astra'); cli.request('novel-matched-off',None)
        cli.send('/fast'); cli.wait(lambda:enabled() is True,'novel-bare-on'); cli.request('novel-matched-on','priority'); cli.close()
        # Cold CLI resume of saved child state, preserving global bytes.
        before=config.read_bytes()
        cli=Cli('child-initial',child=True); cli.request('child-initial-priority','priority')
        session=Path(cli.session)
        cli.send('/fast off')
        def child_value():
            entries=[json.loads(s) for s in session.read_text().splitlines()]
            return [e['data']['enabled'] for e in entries if e.get('customType')=='pi-fast-mode-session'][-1]
        cli.wait(lambda:child_value() is False,'child-saved-off')
        n=len(events()); cli.send('/reload'); cli.wait(lambda:any(e['type']=='ready' for e in events()[n:]),'child-reload')
        cli.request('child-reload-off',None); cli.close()
        cli=Cli('child-cold-resume',['--session',str(session),'--fast'],child=True)
        cli.request('saved-off-overrides-launch-true-and-flag',None)
        cli.send('/fast on'); cli.wait(lambda:child_value() is True,'child-saved-on'); cli.close()
        cli=Cli('child-resume-no-launch',['--session',str(session)])
        cli.request('child-saved-on-without-launch','priority')
        n=len(events()); cli.send('/reload'); cli.wait(lambda:any(e['type']=='ready' for e in events()[n:]),'child-reload-on')
        cli.request('child-reload-keeps-on','priority'); cli.close()
        assert config.read_bytes()==before, 'Child changed global configuration'
        # Project-local extension loaded from an actual .pi path.
        local=root/'workspace/.pi/extensions/fast'
        shutil.copytree(repo/'extensions/openai-fast-mode/dist',local)
        cli=Cli('project-scope',['--approve','--fast'],entry=local/'index.js')
        project=root/'workspace/.pi/pi-openai-fast-mode/config.json'
        assert enabled(project) is True, 'Project installation must persist project config'
        cli.request('project-priority','priority')
        cli.send('/fast off'); cli.wait(lambda:enabled(project) is False,'project-off'); cli.close()
        assert config.read_bytes()==before, 'Project changed global configuration'
    passed=True
except BaseException:
    failure=traceback.format_exc(); print(failure,file=sys.stderr)
finally:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    if current is not None: current.close(False)
    for name in ['agent','sessions','workspace']:
        shutil.copytree(root/name,evidence/name,dirs_exist_ok=True)
    (evidence/'journey.json').write_text(json.dumps({'passed':passed,'failure':failure,'processStopped':all(r['processStopped'] for r in records),'pids':processes,'runs':records,'checks':checks,'events':events()},ensure_ascii=False,indent=2))
print(json.dumps({'passed':passed,'evidence':str(evidence)}))
sys.exit(0 if passed else 1)
