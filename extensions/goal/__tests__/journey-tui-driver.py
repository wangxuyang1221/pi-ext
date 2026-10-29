import os,sys,json,time,pty,select,signal,errno,fcntl,termios,struct,codecs
from pathlib import Path
import pyte
root=Path(sys.argv[1]);from signal_support import install;install(root, globals()); pids=[]; actions=[]; screens={}; status=None

def start(phase):
 global pid,fd,status,screen,stream,decoder,transcript,events_path
 pid,fd=pty.fork()
 if pid==0:
  os.environ['AUDIT_PHASE']=phase
  os.execvp('node',['node','extensions/goal/__tests__/journey-tui.mjs'])
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
 start('create');wait(lambda:any(e['event']=='ready' for e in events()),'ready');settle()
 cmd('AUDIT_SEED');wait(lambda:any(e['event']=='settled' for e in events()),'seed history')
 cmd('/audit-next');cmd('/goal Audit independent combination');text('Goal saved.');text('Paused')
 first=snap('created'); original=own(first);assert original['goal']['status']=='paused';assert original['goal']['objective']=='Audit independent combination'
 cmd('/goal edit');text('Edit goal');send(b'\x05 EDITED\r');text('Goal updated.');edited=snap('edited')
 assert own(edited)['goal']['goalId']==original['goal']['goalId'];assert own(edited)['goal']['tokensUsed']==original['goal']['tokensUsed'];assert own(edited)['goal']['objective'].endswith(' EDITED')
 cmd('/goal Replacement should cancel');text('Replace current goal?');send(b'\x1b');cancel=snap('replace-cancel');assert own(cancel)['goal']==own(edited)['goal']
 cmd('/goal');text('opening snapshot');send(b'\x1b');wait(lambda:'opening snapshot' not in view(),'details closed');quit()
 start('reopen');text('Resume saved goal?');send(b'\x1b');settle();reopened=snap('reopened-cancel')
 assert own(reopened)['goal']==own(edited)['goal'];assert reopened['calls']==0
 ready_count=sum(e['event']=='ready' for e in events())
 cmd('/goal-fork');text('Inherit current goal');send(b'\x1b[B\r');wait(lambda:sum(e['event']=='ready' for e in events())>=ready_count+2,'inherited session reload');settle()
 inherited=snap('inherited-clone');new=own(inherited);assert new['recordId']!=original['recordId'];assert new['goal']['goalId']==original['goal']['goalId'];assert new['continuationDeferral'] is True;assert new['goal']['tokensUsed']==original['goal']['tokensUsed'];assert inherited['calls']==0
 source=next(r for r in inherited['records'] if r['recordId']==original['recordId']);assert source['goal']==own(edited)['goal']
 cmd('/reload');text('Reloaded');settle();reloaded=snap('clone-reloaded');assert own(reloaded)['continuationDeferral'] is True;assert reloaded['calls']==0
 cmd('/clone');settle(.8);native=snap('native-clone');assert native['sessionId']!=inherited['sessionId'];assert own(native) is None or own(native).get('goal') is None
 cmd('/goal-recover');text('Recover goal');send(b'\x1b');cancelrecover=snap('recover-cancel');assert cancelrecover['sessionId']==native['sessionId'];assert cancelrecover['calls']==0
 cmd('/goal-recover');text('Recover goal');send(b'\r');settle(.8)
 if 'Resume saved goal?' in view():send(b'\x1b')
 recovered=snap('recovered');assert own(recovered)['goal']['goalId']==original['goal']['goalId'];assert recovered['calls']==0
 cmd('/goal clear');text('Goal cleared.');cleared=snap('cleared');assert own(cleared).get('goal') is None
 quit();start('reopen-clear');settle(.8)
 final=snap('cleared-reopened');assert own(final).get('goal') is None;assert final['calls']==0
 quit()
 (root/'result.json').write_text(json.dumps({'passed':True,'pids':pids}))
finally:
 if status is None:
  os.killpg(pid,signal.SIGTERM)
  end=time.monotonic()+3
  while status is None and time.monotonic()<end:pump()
  if status is None:os.killpg(pid,signal.SIGKILL);os.waitpid(pid,0)
  os.close(fd);transcript.close()
 (root/'actions.json').write_text(json.dumps(actions,ensure_ascii=False,indent=2));(root/'screens.json').write_text(json.dumps(screens,ensure_ascii=False,indent=2))
