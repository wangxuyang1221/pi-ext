"""Drive real Pi PTY permissions and preserve observable evidence."""
import codecs, errno, fcntl, json, os, pty, select, shutil, signal, struct, sys, termios, time, traceback
from pathlib import Path
import pyte
repo = Path.cwd()
here = Path(__file__).resolve().parent
label, scratch, output = sys.argv[1:]
root, evidence = Path(scratch), Path(output)
for name in ['workspace','sessions']:
    (root/name).mkdir()
(root/'agent/settings.json').write_text(json.dumps({'quietStartup':True,'defaultProjectTrust':'never','compaction':{'enabled':False},'retry':{'enabled':False},'cacheWarming':'off'}))
(root/'mcp.json').write_text(json.dumps({'mcpServers':{name:{'command':'node','args':[str(here/'mcp-server.mjs'),str(root/'mcp-events.jsonl'),name], 'retry':{'maxAttempts':1,'background':False}} for name in ['alpha','beta']}}))
processes, results, actions = [], [], []
def interrupted(signum, frame):
    raise KeyboardInterrupt('Verification interrupted')
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
def record_assert(name, condition, detail=None):
    results.append({'name':name,'passed':bool(condition),'detail':detail})
    assert condition, name + ': ' + str(detail)
def records(name='events.jsonl'):
    path=root/name
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
def files():
    return {str(p.relative_to(root/'workspace')):p.read_text() for p in (root/'workspace').rglob('*') if p.is_file()}
def calls():
    return [r for r in records('mcp-events.jsonl') if r['type']=='call']
class Pi:
    def __init__(self, name, mode='default', mcp=False):
        self.name=name; self.raw=bytearray(); self.status=None; self.screens={}; self.counter=0
        self.screen=pyte.Screen(160,55); self.stream=pyte.Stream(self.screen); self.decoder=codecs.getincrementaldecoder('utf-8')('replace')
        self.args=['node',str(repo/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--tools','+grep,+find,+ls','--session-dir',str(root/'sessions'),'--provider','faux','--model','faux-1','-e',str(Path(os.environ.get('PI_PERMISSIONS_VERIFY_ENTRY', str(repo/'extensions/permissions/src/index.ts')))),'-e',str(here/'provider.ts')]
        if mcp: self.args+=['-e',str(repo/'extensions/mcp/dist/index.js')]
        env=dict(os.environ,PI_VERIFY_ROOT=str(root),PI_MCP_CONFIG=str(root/'mcp.json'),TERM='xterm-256color')
        env.pop('PI_PERMISSIONS_MODE', None)
        if mode is not None: env['PI_PERMISSIONS_MODE']=mode
        ready=len([r for r in records() if r['type']=='ready'])
        self.pid,self.fd=pty.fork()
        if self.pid==0:
            os.chdir(root/'workspace'); os.execvpe(self.args[0],self.args,env)
        processes.append(self)
        (root/'owned-processes.json').write_text(json.dumps([p.pid for p in processes]))
        fcntl.ioctl(self.fd,termios.TIOCSWINSZ,struct.pack('HHHH',55,160,0,0))
        self.wait(lambda: len([r for r in records() if r['type']=='ready'])>ready, 'ready')
        self.drain(.2)
        record_assert(name+'-startup', 'Extension issues' not in self.view())
    def view(self): return '\n'.join(line.rstrip() for line in self.screen.display)
    def pump(self):
        if select.select([self.fd],[],[],.01)[0]:
            try: chunk=os.read(self.fd,65536)
            except OSError as e:
                if e.errno!=errno.EIO: raise
                chunk=b''
            self.raw.extend(chunk)
            if b'\x1b[6n' in chunk: os.write(self.fd,b'\x1b[1;1R')
            self.stream.feed(self.decoder.decode(chunk))
        if self.status is None:
            done,status=os.waitpid(self.pid,os.WNOHANG)
            if done: self.status=status
    def drain(self,duration):
        end=time.monotonic()+duration
        while time.monotonic()<end: self.pump()
    def wait(self,predicate,name):
        end=time.monotonic()+30
        while time.monotonic()<end:
            self.pump()
            if predicate():
                self.counter+=1; self.screens[f'{self.counter}-{name}']=self.view(); return
            if self.status is not None: break
        raise AssertionError(name+'\n'+self.view())
    def key(self,value,description):
        actions.append({'process':self.name,'at':time.monotonic(),'action':description,'bytes':value.hex()})
        os.write(self.fd,value)
    def send(self,text): self.key(text.encode()+b'\r',text)
    def choose(self,index,description): self.key(b'\x1b[B'*index+b'\r',description)
    def tool(self,name,args,choice=None,note=None):
        before=len(records()); settled=sum(r['type']=='settled' for r in records()); before_files=files(); before_calls=calls()
        self.send('VERIFY_TOOL '+json.dumps({'name':name,'args':args},separators=(',',':')))
        if choice is not None:
            self.wait(lambda: f'Allow Pi to run {name}?' in self.view(), 'approval-'+name)
            record_assert(name+'-pending-no-side-effect',files()==before_files and calls()==before_calls)
            if choice=='escape': self.key(b'\x1b','Escape approval')
            else: self.choose(choice,['Allow once','Allow this session','Deny','Deny with note','Cancel'][choice])
            if choice==3:
                self.wait(lambda: 'Add guidance for Pi' in self.view(),'note-editor')
                self.send(note)
        def complete():
            if choice is None:
                assert 'Allow Pi to run ' not in self.view(), 'Unexpected approval for '+name
            return sum(r['type']=='settled' for r in records())>settled
        self.wait(complete,'settled-'+name)
        self.drain(.05)
        after=records()[before:]
        actions.append({'process':self.name,'tool':name,'args':args,'choice':choice,'beforeFiles':before_files,'afterFiles':files(),'beforeCalls':len(before_calls),'afterCalls':len(calls())})
        if choice in [2,3,4,'escape']:
            record_assert(name+'-denied-unchanged',files()==before_files and calls()==before_calls)
        else:
            errors=[r for r in after if r['type']=='tool' and r['data'].get('isError')]
            record_assert(name+'-execution-succeeded',not errors,errors)
        if choice==4:
            record_assert(name+'-cancel-aborted',any(r['type']=='tool' and 'aborted' in json.dumps(r['data']).lower() for r in after),after)
            record_assert(name+'-cancel-no-model-continuation',not any(r['type']=='request' and r['data'].get('role')=='toolResult' for r in after),after)
        if choice==3:
            record_assert(name+'-note-reached-provider',any(r['type']=='request' and r['data'].get('role')=='toolResult' and note in json.dumps(r['data']) for r in after))
        return after
    def close(self):
        if self.status is None:
            self.send('/quit'); self.wait(lambda:self.status is not None,'quit')
        record_assert(self.name+'-exit-zero',os.waitstatus_to_exitcode(self.status)==0)
    def save(self):
        if self.status is None:
            try: os.killpg(self.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            os.waitpid(self.pid,0)
        os.close(self.fd)
        (evidence/(self.name+'.ansi')).write_bytes(self.raw)
        (evidence/(self.name+'.screens.json')).write_text(json.dumps(self.screens,indent=2))
        try: os.kill(self.pid,0); return False
        except ProcessLookupError: return True
passed=False
try:
    if label == "capacity":
        p=Pi('capacity')
        for index in range(1,514):
            p.tool('write',{'path':f'capacity/{index}.txt','content':str(index)+'\n'},1)
            record_assert(f'capacity-{index}-bytes',(root/f'workspace/capacity/{index}.txt').read_text()==str(index)+'\n')
            if index%25==0: print(json.dumps({'approved':index}),flush=True)
        p.tool('write',{'path':'capacity/513.txt','content':'latest retained\n'})
        record_assert('latest-grant-retained',(root/'workspace/capacity/513.txt').read_text()=='latest retained\n')
        p.tool('write',{'path':'capacity/1.txt','content':'wrong\n'},2)
        record_assert('oldest-grant-evicted',(root/'workspace/capacity/1.txt').read_text()=='1\n')
        p.close()
    elif label == "deny-probe":
        p=Pi('deny-probe')
        p.tool('write',{'path':'denied.txt','content':'must not exist\n'},2)
        record_assert('denied-file-absent',not (root/'workspace/denied.txt').exists())
        p.close()
    else:
        p=Pi('tools',mcp=True)
        # Deny, note, cancel, escape, and allow once on every risky tool family.
        for tool,args in [
            ('write',{'path':'approval.txt','content':'approved\n'}),
            ('edit',{'path':'edit.txt','oldText':'before','newText':'after'}),
            ('bash',{'command':"printf 'approved\\n' > bash.txt"}),
            ('mcp__alpha__echo',{'text':'approved'}),
        ]:
            if tool=='edit': (root/'workspace/edit.txt').write_text('before\n')
            for choice in [2,3,4,'escape']:
                p.tool(tool,args,choice,note='Keep audit files unchanged')
            p.tool(tool,args,0)
            if tool=='write': record_assert('write-allowed-bytes',(root/'workspace/approval.txt').read_text()=='approved\n')
            if tool=='edit': record_assert('edit-allowed-bytes',(root/'workspace/edit.txt').read_text()=='after\n')
            if tool=='bash': record_assert('bash-allowed-bytes',(root/'workspace/bash.txt').read_text()=='approved\n')
            if tool.startswith('mcp'): record_assert('mcp-allowed-call',len(calls())==1 and calls()[0]['args']==args)
            # Allow once does not create a grant.
            again=dict(args)
            if tool=='edit': again.update(oldText='after',newText='again')
            p.tool(tool,again,2)
        for tool,args in [('read',{'path':'approval.txt'}),('grep',{'pattern':'approved','path':'.'}),('find',{'pattern':'*.txt','path':'.'}),('ls',{'path':'.'})]:
            before=files(); after=p.tool(tool,args)
            record_assert(tool+'-read-only',files()==before)
            record_assert(tool+'-result-observed',any(r['type']=='tool' and r['data']['toolName']==tool for r in after))
        # New combination: write grant, normalized path, edit boundary, another target, restart.
        p.tool('write',{'path':'scope/a.txt','content':'first\n'},1)
        p.tool('write',{'path':'scope/../scope/a.txt','content':'second\n'})
        record_assert('normalized-path-updated-bytes',(root/'workspace/scope/a.txt').read_text()=='second\n')
        p.tool('write',{'path':'scope/b.txt','content':'wrong\n'},2)
        p.tool('edit',{'path':'scope/a.txt','oldText':'second','newText':'third'},1)
        p.tool('edit',{'path':'scope/../scope/a.txt','oldText':'third','newText':'fourth'})
        (root/'workspace/scope/b.txt').write_text('before\n')
        p.tool('edit',{'path':'scope/b.txt','oldText':'before','newText':'wrong'},2)
        cmd="printf 'x' >> exact.txt"
        p.tool('bash',{'command':cmd},1)
        p.tool('bash',{'command':cmd})
        record_assert('bash-exact-repeat-bytes',(root/'workspace/exact.txt').read_text()=='xx')
        p.tool('bash',{'command':"printf 'y' >> exact.txt"},2)
        p.tool('mcp__alpha__echo',{'text':'grant'},1)
        p.tool('mcp__alpha__echo',{'text':'changed-arguments'})
        p.tool('mcp__alpha__other',{'text':'wrong'},2)
        p.tool('mcp__beta__echo',{'text':'wrong'},2)
        # Command and menu transitions must alter the next ungranted tool call.
        p.send('/permissions full'); p.wait(lambda:'Enable Full access?' in p.view(),'full-confirm')
        p.key(b'\x1b','Escape full'); p.wait(lambda:'Enable Full access?' not in p.view(),'full-cancel')
        p.tool('write',{'path':'mode.txt','content':'full\n'},2)
        p.send('/permissions'); p.wait(lambda:'Update Model Permissions' in p.view(),'menu')
        p.choose(1,'Full access'); p.wait(lambda:'Enable Full access?' in p.view(),'menu-full-confirm')
        p.choose(0,'Yes, continue anyway'); p.wait(lambda:'· full access' in '\n'.join(p.screen.display[-3:]),'full-footer')
        p.tool('write',{'path':'mode.txt','content':'full\n'})
        record_assert('full-file-bytes',(root/'workspace/mode.txt').read_text()=='full\n')
        p.send('/permissions default'); p.wait(lambda:'· full access' not in '\n'.join(p.screen.display[-3:]),'default-footer')
        p.tool('write',{'path':'mode.txt','content':'wrong\n'},2)
        p.send('/permissions full'); p.wait(lambda:'Enable Full access?' in p.view(),'command-full-confirm')
        p.choose(0,'Yes, continue anyway'); p.wait(lambda:'· full access' in '\n'.join(p.screen.display[-3:]),'command-full-footer')
        p.tool('write',{'path':'command-full.txt','content':'yes\n'})
        p.send('/permissions'); p.wait(lambda:'Update Model Permissions' in p.view(),'menu-default')
        p.choose(0,'Default permissions'); p.wait(lambda:'· full access' not in '\n'.join(p.screen.display[-3:]),'menu-default-footer')
        p.tool('write',{'path':'menu-default.txt','content':'wrong\n'},2)
        p.send('/permissions full'); p.wait(lambda:'Enable Full access?' in p.view(),'full-confirm')
        p.choose(1,'Cancel Full access'); p.wait(lambda:'Enable Full access?' not in p.view(),'full-cancel-choice')
        p.tool('write',{'path':'edge.txt','content':'wrong\n'},2)
        p.send('/permissions');p.wait(lambda:'Update Model Permissions' in p.view(),'menu')
        p.key(b'\x1b','Escape menu');p.wait(lambda:'Update Model Permissions' not in p.view(),'menu-cancel')
        p.tool('write',{'path':'edge.txt','content':'wrong\n'},2)
        p.close()
        q=Pi('restart',mcp=True)
        for tool,args in [('write',{'path':'scope/a.txt','content':'wrong\n'}),('edit',{'path':'scope/a.txt','oldText':'fourth','newText':'wrong'}),('bash',{'command':cmd}),('mcp__alpha__echo',{'text':'wrong'})]: q.tool(tool,args,2)
        record_assert('restart-file-retained',(root/'workspace/scope/a.txt').read_text()=='fourth\n')
        q.close()
        for name,mode in [('env-full','full'),('env-unset',None)]:
            q=Pi(name,mode)
            q.tool('write',{'path':name+'.txt','content':'unprompted\n'})
            record_assert(name+'-bytes',(root/('workspace/'+name+'.txt')).read_text()=='unprompted\n')
            q.close()
    passed=True
except (Exception, KeyboardInterrupt):
    traceback.print_exc()
finally:
    stopped=[p.save() for p in processes]
    for name in ['workspace','sessions','agent']:
        shutil.copytree(root/name,evidence/name,dirs_exist_ok=True)
    # All local server PIDs are emitted by the server itself before accepting requests.
    server_pids=sorted({r['pid'] for r in records('mcp-events.jsonl')})
    server_alive=[]
    for pid in server_pids:
        try: os.kill(pid,0); server_alive.append(pid)
        except ProcessLookupError: pass
    result={'passed':passed,'driver':'permissions-pty','processStopped':all(stopped) and not server_alive,'processes':[{'pid':p.pid,'name':p.name,'command':p.args} for p in processes],'serverPids':server_pids,'serverAlive':server_alive,'results':results,'actions':actions,'events':records(),'mcpEvents':records('mcp-events.jsonl')}
    (evidence/'journey.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'passed':passed,'assertions':len(results),'processStopped':result['processStopped']}))
if not passed: sys.exit(1)
