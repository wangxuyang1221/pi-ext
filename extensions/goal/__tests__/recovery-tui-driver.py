import os,sys,json,time,pty,select,signal,errno,fcntl,termios,struct,codecs
from pathlib import Path
import pyte
root=Path(sys.argv[1]);from signal_support import install;install(root, globals()); pids=[]; actions=[]; screens={}; status=None

def start(phase):
 global pid,fd,status,screen,stream,decoder,transcript,events_path
 pid,fd=pty.fork()
 if pid==0:
  os.environ['AUDIT_PHASE']=phase
  os.execvp('node',['node','extensions/goal/__tests__/recovery-tui.mjs'])
 pids.append(pid);(root/'pids.json').write_text(json.dumps(pids));status=None
 fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',42,120,0,0));os.set_blocking(fd,False)
 screen=pyte.Screen(120,42);stream=pyte.Stream(screen);decoder=codecs.getincrementaldecoder('utf-8')('replace')
 transcript=(root/f'terminal-{phase}.ansi').open('wb');events_path=root/f'events-{phase}.jsonl'
def view():return '\n'.join(screen.display)
def events():return [json.loads(x) for x in events_path.read_text().splitlines()] if events_path.exists() else []
def pump():
 global status
 ready,_,_=select.select([fd],[],[],.04)
 if ready:
  try:data=os.read(fd,65536)
  except OSError as e:
   if e.errno!=errno.EIO:raise
   data=b''
  transcript.write(data);transcript.flush();stream.feed(decoder.decode(data))
 if status is None:
  done,s=os.waitpid(pid,os.WNOHANG)
  if done:status=s
def settle(seconds=.35):
 end=time.monotonic()+seconds
 while time.monotonic()<end:pump()
def wait(p,label):
 end=time.monotonic()+15
 while time.monotonic()<end:
  pump()
  if p():return
  if status is not None:break
 raise AssertionError(f'{label}\n{view()}')
def send(data):
 actions.append({'at':time.time(),'input':data.decode(errors='replace')})
 os.write(fd,data);settle(.15)
def cmd(s):send(s.encode()+b'\r')
def text(s):wait(lambda:s in view(),s)
def snap(label):
 cmd('/audit-snapshot '+label);wait(lambda:any(e.get('label')==label for e in events()),label)
 screens[label]=view();return next(e for e in reversed(events()) if e.get('label')==label)
def own(s):return next((r for r in s['records'] if r['ownerSessionId']==s['sessionId']),None)
def quit():
 cmd('/audit-exit');wait(lambda:status is not None,'exit');assert os.waitstatus_to_exitcode(status)==0;os.close(fd);transcript.close()
try:
 start('crash');wait(lambda:any(e['event']=='ready' for e in events()),'ready');settle()
 cmd('/goal Durable before first reply');wait(lambda:any(e['event']=='stream-start' for e in events()),'stream started');settle(.2)
 before=snap('before-first-reply');saved=own(before);assert saved['goal']['status']=='active';assert not Path(saved['sessionFile']).exists(),'Session unexpectedly persisted before first assistant completion'
 (root/'record-before-crash.json').write_text(json.dumps(saved,indent=2))
 os.killpg(pid,signal.SIGTERM);wait(lambda:status is not None,'crash exited');os.close(fd);transcript.close()
 start('recover-orphan');wait(lambda:any(e['event']=='ready' for e in events()),'new session ready');settle()
 cmd('/goal-recover');text('Recover goal');send(b'\r');text('Recover goal without conversation?');screens['orphan-warning']=view();send(b'\x1b');settle();rejected=snap('orphan-rejected');assert own(rejected) is None;assert rejected['calls']==0
 cmd('/goal-recover');text('Recover goal');send(b'\r');text('Recover goal without conversation?');send(b'\r');settle()
 wait(lambda:sum(e['event']=='ready' for e in events())>=3,'orphan switched and reloaded');settle();recovered=snap('orphan-recovered');actual=own(recovered)
 assert actual['recordId']==saved['recordId'];assert actual['ownerSessionId']!=saved['ownerSessionId'];assert actual['goal']['goalId']==saved['goal']['goalId'];assert actual['goal']['tokensUsed']==saved['goal']['tokensUsed'];assert recovered['calls']==0
 cmd('/goal pause');text('Goal paused.');paused=snap('paused-after-takeover');assert own(paused)['goal']['status']=='paused'
 cmd('/audit-next');cmd('Explicit context check after recovery');wait(lambda:any(e['event']=='settled' for e in events()),'follow-up after recovery');after=snap('recovery-follow-up');assert after['calls']==2;assert own(after)['goal']['goalId']==saved['goal']['goalId'];assert 'Durable before first reply' in json.dumps(events())
 quit();(root/'result.json').write_text(json.dumps({'passed':True,'pids':pids}))
finally:
 if status is None:
  os.killpg(pid,signal.SIGTERM)
  end=time.monotonic()+3
  while status is None and time.monotonic()<end:pump()
  if status is None:os.killpg(pid,signal.SIGKILL);os.waitpid(pid,0)
  os.close(fd);transcript.close()
 (root/'actions.json').write_text(json.dumps(actions,ensure_ascii=False,indent=2));(root/'screens.json').write_text(json.dumps(screens,ensure_ascii=False,indent=2))
