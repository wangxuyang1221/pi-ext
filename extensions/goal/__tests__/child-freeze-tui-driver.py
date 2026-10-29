import os,sys,json,time,pty,select,signal,errno,fcntl,termios,struct,codecs
from pathlib import Path
import pyte
root=Path(sys.argv[1]);from signal_support import install;install(root, globals()); pids=[]; actions=[]; screens={}; status=None

def start(phase):
 global pid,fd,status,screen,stream,decoder,transcript,events_path
 pid,fd=pty.fork()
 if pid==0:
  os.environ['AUDIT_PHASE']=phase
  os.environ['GOAL_PROBE_ROOT']=str(root)
  os.execvp('node',['node','extensions/goal/__tests__/accounting-tui.mjs',sys.argv[2]])
 pids.append(pid);(root/'pids.json').write_text(json.dumps(pids));status=None
 fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',42,120,0,0));os.set_blocking(fd,False)
 screen=pyte.Screen(120,42);stream=pyte.Stream(screen);decoder=codecs.getincrementaldecoder('utf-8')('replace')
 transcript=(root/f'terminal-{phase}.ansi').open('wb');events_path=root/'events.jsonl'
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
scenario=os.environ.get('GOAL_USAGE_SOURCE','freeze-paused')
try:
 start('freeze');wait(lambda:any(e['event']=='ready' for e in events()),'ready');settle();cmd('/goal Direct child '+scenario)
 wait(lambda:any(e['event']=='child-waiting' and e['stage']==1 for e in events()),'first child gate');cmd('/freeze-release 1')
 wait(lambda:any(e['event']=='settled' for e in events()),'stopped root');rows=events();first=next(e for e in rows if e['event']=='settled')['goal'];assert first['status']==scenario[7:];assert first['tokensUsed']==10
 cmd('/freeze-release 2');wait(lambda:any(e['event']=='child-waiting' and e['stage']==3 for e in events()),'frozen child gate');settle(.5)
 cmd('/freeze-snapshot frozen');wait(lambda:any(e.get('label')=='frozen' for e in events()),'frozen snapshot');frozen=next(e for e in events() if e.get('label')=='frozen')['goal'];assert frozen['tokensUsed']==10;assert frozen['childUsage'][0]['tokens']==50;assert frozen['elapsedSeconds']==first['elapsedSeconds']
 cmd('/freeze-responses');wait(lambda:any(e['event']=='resume-responses' for e in events()),'resume provider ready');cmd('/goal resume');wait(lambda:any(e['event']=='final-child-waiting' for e in events()),'resumed root')
 cmd('/freeze-snapshot resumed');wait(lambda:any(e.get('label')=='resumed' for e in events()),'resume snapshot');resumed=next(e for e in events() if e.get('label')=='resumed')['goal'];assert resumed['tokensUsed']==10;assert resumed['childUsage'][0]['tokens']==50
 cmd('/freeze-release 3');wait(lambda:sum(e['event']=='settled' for e in events())==2,'final settled');cmd('/accounting-exit');wait(lambda:status is not None,'exit');assert os.waitstatus_to_exitcode(status)==0
 result=next(e for e in events() if e['event']=='result');assert result['goal']['tokensUsed']==20;assert result['goal']['status']=='paused';assert result['networkAttempts']==0
 (root/'result.json').write_text(json.dumps({'passed':True,'scenario':scenario,'first':first,'frozen':frozen,'resumed':resumed,'result':result},indent=2))
finally:
 if status is None:
  os.killpg(pid,signal.SIGTERM)
  end=time.monotonic()+3
  while status is None and time.monotonic()<end:pump()
  if status is None:os.killpg(pid,signal.SIGKILL);os.waitpid(pid,0)
 os.close(fd);transcript.close()
 (root/'actions.json').write_text(json.dumps(actions,ensure_ascii=False,indent=2));(root/'screens.json').write_text(json.dumps(screens,ensure_ascii=False,indent=2))
