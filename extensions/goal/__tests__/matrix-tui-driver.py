import os,sys,json,time,pty,select,signal,errno,fcntl,termios,struct,codecs
from pathlib import Path
import pyte
import uuid,base64
root=Path(sys.argv[1]);from signal_support import install;install(root, globals()); pids=[]; actions=[]; screens={}; status=None

def start(phase):
 global pid,fd,status,screen,stream,decoder,transcript,events_path
 pid,fd=pty.fork()
 if pid==0:
  os.environ['GOAL_MATRIX_PHASE']=phase
  os.execvp('node',['node','extensions/goal/__tests__/matrix-tui.mjs'])
 pids.append(pid);(root/'pids.json').write_text(json.dumps(pids));status=None
 fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',42,120,0,0));os.set_blocking(fd,False)
 screen=pyte.Screen(120,42);stream=pyte.Stream(screen);decoder=codecs.getincrementaldecoder('utf-8')('replace')
 transcript=(root/f'terminal-{phase}.ansi').open('wb');events_path=root/f'events-{phase}.jsonl'
def view():return '\n'.join(screen.display)
def panel(value):
 lines=value.splitlines();start=next(i for i,line in enumerate(lines) if 'Goal details · opening snapshot' in line);end=next(i for i,line in enumerate(lines) if i>=start and '[esc] Close' in line);return '\n'.join(lines[start:end+1])
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
 offset=0
 while offset<len(data):
  try:offset+=os.write(fd,data[offset:offset+4096])
  except BlockingIOError:pump()
 settle(.15)
def cmd(s):send(b'\x15'+s.encode()+b'\r')
def text(s):wait(lambda:s in view(),s)
def snap(label):
 cmd('/matrix-snapshot '+label);wait(lambda:any(e.get('label')==label for e in events()),label)
 screens[label]=view();return next(e for e in reversed(events()) if e.get('label')==label)
def own(s):return next((r for r in s['records'] if r['ownerSessionId']==s['sessionId']),None)
def quit():
 cmd('/matrix-exit');wait(lambda:status is not None,'exit');assert os.waitstatus_to_exitcode(status)==0;os.close(fd);transcript.close()

def seed(name):
 cmd('/matrix-seed '+name);wait(lambda:any(e.get('name')==name and e['event']=='seeded' for e in events()),'seeded');settle()
def settled(n):wait(lambda:sum(e['event']=='settled' for e in events())>=n,'settled')
def state(label):return own(snap(label))
def paste(value):send(b'\x1b[200~'+value.encode()+b'\x1b[201~');send(b'\r')
def close():send(b'\x1b');wait(lambda:'opening snapshot' not in view(),'details close')
scenario=os.environ.get('GOAL_MATRIX_SCENARIO','lifecycle')
try:
 start('create');wait(lambda:any(e['event']=='ready' for e in events()),'ready');settle()
 if scenario=='signal':
  signal.signal(signal.SIGTERM,signal.SIG_IGN)
  seed('gate');cmd('/goal Signal cleanup probe');wait(lambda:any(e['event']=='response_waiting' for e in events()),'held response');(root/'signal-ready.json').write_text(json.dumps({'pid':pid}))
  while status is None:pump()
 elif scenario=='lifecycle':
  old=state('original')['goal'];assert old['status']=='active'
  fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',20,80,0,0));screen.resize(20,80);settle()
  cmd('/goal');text('[p] Pause');settle()
  screens['details-top']=view();send(b'\x1b[B');screens['details-arrow-down']=view();assert panel(screens['details-arrow-down'])!=panel(screens['details-top'])
  send(b'\x1b[6~');screens['details-down']=view();send(b'\x1b[A');screens['details-arrow-up']=view();assert panel(screens['details-arrow-up'])!=panel(screens['details-down'])
  send(b'\x1b[5~');screens['details-up']=view()
  assert panel(screens['details-down'])!=panel(screens['details-top']),'Scrolling must change rendered details'
  assert panel(screens['details-up'])==panel(screens['details-top']),'Scrolling back must restore the opening snapshot'
  send(b'p');wait(lambda:'opening snapshot' not in view(),'panel pause closes');paused=state('panel-paused')['goal'];assert paused['status']=='paused'
  cmd('/goal');text('opening snapshot');send(b'\r');wait(lambda:'opening snapshot' not in view(),'Enter closes details');assert state('enter-close')['goal']['status']=='paused'
  seed('pause');cmd('/goal Replacement accepted');text('Replace current goal?');send(b'\r');settled(1)
  replaced=state('replaced')['goal'];assert replaced['goalId']!=old['goalId'];assert replaced['objective']=='Replacement accepted';last_call=[e['message'] for e in events() if e['event']=='message' and e['message']['role']=='assistant' and any(part.get('type')=='toolCall' for part in e['message']['content'])][-1];usage=last_call['usage'];assert replaced['tokensUsed']==usage['input']+usage['output']+usage['cacheWrite'],'Replacement must account only its new activation'
 elif scenario=='time':
  initial=state('clock-start');source_path=root/'goals'/(initial['recordId']+'.json');assert initial['goal']['elapsedSeconds']==12
  settle(2.2);quit();before=json.loads(source_path.read_text())['goal'];assert before['elapsedSeconds']>=14
  time.sleep(3.2);start('reopen-clock');wait(lambda:any(e['event']=='ready' for e in events()),'clock reopened');settle(.4)
  after=state('clock-after-offline')['goal'];assert after['elapsedSeconds']==before['elapsedSeconds'],'Offline wall time must not accrue'
  settle(2.2);cmd('/goal pause');text('Goal paused.');final=state('clock-paused')['goal'];assert 2<=final['elapsedSeconds']-after['elapsedSeconds']<=4
 elif scenario=='inheritance':
  original=state('source-active');source_path=root/'goals'/(original['recordId']+'.json');source_bytes=source_path.read_bytes()
  ready_before=sum(e['event']=='ready' for e in events());cmd('/goal-fork');text('Inherit current goal');send(b'\x1b[B\r');wait(lambda:sum(e['event']=='ready' for e in events())>=ready_before+2,'clone reload');settle();inherited=snap('active-clone');copied=own(inherited)
  assert copied['goal']==original['goal'];assert copied['recordId']!=original['recordId'];assert copied['ownerSessionId']!=original['ownerSessionId'];assert copied['continuationDeferral'] is True;assert inherited['calls']==0;assert source_path.read_bytes()==source_bytes
  cmd('/reload');text('Reloaded');settle();assert state('active-clone-reloaded')['continuationDeferral'] is True
  quit();start('reopen-inherited');wait(lambda:any(e['event']=='ready' for e in events()),'cold clone reopen');settle();cold=snap('active-clone-cold');assert own(cold)['continuationDeferral'] is True;assert cold['calls']==0
  seed('pause');cmd('Explicit user starts inherited goal');settled(1);released=state('deferral-released');assert released['continuationDeferral'] is False;assert released['goal']['goalId']==original['goal']['goalId'];assert source_path.read_bytes()==source_bytes
  goal_before=released['goal'];cmd('/tree');text('Session Tree');screens['tree-selector']=view();send(b'\x1b[A\r');settle()
  if 'Summarize branch?' in view():send(b'\r')
  wait(lambda:'Session Tree' not in view(),'tree navigation closed');tree=snap('tree-selected');assert own(tree)['goal']==goal_before
  ready_before=sum(e['event']=='ready' for e in events());cmd('/goal-fork');text('Inherit current goal');send(b'\r');text('Fork before user message');send(b'\x1b[B\r');wait(lambda:sum(e['event']=='ready' for e in events())>=ready_before+2,'historical fork reload');settle();forked=snap('historical-goal-fork');assert own(forked)['recordId']!=copied['recordId'];assert own(forked)['goal']['goalId']==original['goal']['goalId'];assert own(forked)['continuationDeferral'] is True
  cmd('/fork');settle();screens['native-fork-selector']=view();send(b'\r');settle();native=snap('native-forked');assert native['sessionId']!=forked['sessionId'];assert (own(native) or {}).get('goal') is None;assert source_path.read_bytes()==source_bytes
 elif scenario in ('content-select','content-validation'):
  paste('/goal CONTENT_BASE '+('long objective '*350));settled(1);baseline=state('content-original')['goal'];assert baseline['content'];assert baseline['status']=='paused'
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGPk0Y1iIAUwkaSaYVQDcYCJSHVwMKqBGEByKAEA9NsAs1GX4RQAAAAASUVORK5CYII=')
  def candidate():return root/'tmp'/('pi-clipboard-'+str(uuid.uuid4())+'.png')
  image=candidate();image.write_bytes(png)
  if scenario=='content-select':
   cmd('/goal edit');text('Edit goal');send(b'\x05 '+str(image).encode()+b'\r');text('Persist pasted image?');send(b'\x1b[B\r');settle();kept=state('keep-as-text')['goal'];assert str(image) in (root/'goals'/'content'/kept['content']['bundleId']/'objective.txt').read_text();assert kept['content']['attachments']==[]
   cmd('/goal edit');text('Edit goal');send(b'\x05 changed '+str(image).encode()+b'\r');text('Persist pasted image?');send(b'\x1b[B\x1b[B\r');settle();assert state('image-cancel')['goal']==kept
   cmd('/goal Replace content bundle');text('Replace current goal?');send(b'\x1b');assert state('bundle-replace-cancel')['goal']==kept
  else:
   objective=root/'goals'/'content'/baseline['content']['bundleId']/'objective.txt';original_text=objective.read_bytes();objective.write_bytes(b'corrupted objective')
   cmd('/goal edit');text('checksum');assert state('checksum-rejected')['goal']==baseline;objective.write_bytes(original_text)
   for kind in ('symlink','oversized','too-many','text-limit'):
    paths=[]
    if kind=='symlink':
     path=candidate();path.symlink_to(image);paths=[path]
    elif kind=='oversized':
     path=candidate()
     with path.open('wb') as f:f.write(png);f.truncate(20*1024*1024+1)
     paths=[path]
    elif kind=='too-many':
     for i in range(33):
      path=candidate();path.write_bytes(png);paths.append(path)
    cmd('/goal edit');text('Edit goal')
    value=('x'*(1024*1024+1)) if kind=='text-limit' else ' '.join(map(str,paths))
    send(b'\x05 '+b'\x1b[200~'+value.encode()+b'\x1b[201~'+b'\r')
    for i in range(len(paths)):
     text('Persist pasted image?');send(b'\r');settle(.05)
    text('limit' if kind!='symlink' else 'symlink');assert state(kind+'-rejected')['goal']==baseline
 elif scenario.startswith('reopen-'):
  desired=scenario[len('reopen-'):];seed('401' if desired=='blocked' else 'quota' if desired=='usage_limited' else 'pause');cmd('/goal Reopen '+desired);settled(1);original=state('saved-'+desired)['goal'];assert original['status']==desired
  quit();start('reopen-decline');text('Resume saved goal?');send(b'\x1b');declined=snap('resume-declined');assert own(declined)['goal']==original;assert declined['calls']==0;quit()
  start('reopen-accept');text('Resume saved goal?');send(b'\r');settled(1);accepted=snap('resume-accepted');assert own(accepted)['goal']['goalId']==original['goalId'];assert accepted['calls']==2;assert own(accepted)['goal']['status']=='paused'
 elif scenario=='storage':
  cmd('/goal Storage failure recovery');settled(1);before=state('storage-original');source=root/'goals'/(before['recordId']+'.json');original=source.read_bytes()
  cmd('/matrix-storage fail');text('MATRIX_STORAGE fail');cmd('/goal resume');text('Injected isolated disk failure');assert source.read_bytes()==original
  cmd('/matrix-storage repair');text('MATRIX_STORAGE repair');seed('text');cmd('Storage repaired but no resume');settled(2);after=state('storage-not-resumed');assert after['goal']['status']=='paused';assert after['goal']['goalId']==before['goal']['goalId']
  seed('pause');cmd('/goal resume');settled(3);assert state('storage-resumed')['goal']['status']=='paused'
 elif scenario=='lock':
  cmd('/goal Concurrent writer protection');settled(1);first=snap('writer-one');(root/'session.json').write_text(json.dumps({'sessionFile':first['sessionFile']}));record=own(first);source=root/'goals'/(record['recordId']+'.json');original=source.read_bytes()
  saved=(pid,fd,status,screen,stream,decoder,transcript,events_path)
  start('reopen-concurrent');text('Goal already has a writer');cmd('/goal resume');text('Goal already has a writer');other=snap('writer-two-rejected');assert other['calls']==0;assert source.read_bytes()==original;quit()
  pid,fd,status,screen,stream,decoder,transcript,events_path=saved
  assert os.kill(pid,0) is None;assert state('writer-one-still-valid')['goal']==record['goal'];quit()
  lock=root/'goals'/(record['recordId']+'.lock');lock.mkdir();(lock/'uncertain.json').write_text('{')
  start('reopen-uncertain');text('identity is uncertain');assert source.read_bytes()==original;cmd('/matrix-exit');wait(lambda:status is not None,'uncertain exit');os.close(fd);transcript.close();(lock/'uncertain.json').unlink();lock.rmdir()
  start('reopen-repaired');text('Resume saved goal?');send(b'\x1b');assert state('lock-repaired')['goal']==record['goal']
 elif scenario=='freeze':
  completed=0
  for desired in ('paused','blocked','usage_limited','complete'):
   seed('401' if desired=='blocked' else 'quota' if desired=='usage_limited' else 'complete' if desired=='complete' else 'pause');cmd('/goal Freeze '+desired);completed+=1;settled(completed);before=state('freeze-'+desired+'-before')['goal'];assert before['status']==desired
   settle(1.2);seed('text');cmd('Explicit work while goal '+desired);completed+=1;settled(completed);after=state('freeze-'+desired+'-after')['goal'];assert after==before,'Stopped root usage and elapsed time must freeze';cmd('/goal clear');text('Goal cleared.')
  seed('pause');cmd('/goal Activation fence');completed+=1;settled(completed);baseline=state('fence-initial')['goal']
  seed('gate');cmd('/goal resume');wait(lambda:any(e['event']=='response_waiting' for e in events()),'held response');cmd('/goal pause');text('Goal paused.');cmd('/goal resume');text('Goal active.');before=state('fence-resumed')['goal'];assert before['activation']>baseline.get('activation',0)
  cmd('/matrix-release');completed+=1;settled(completed);final=state('fence-settled')['goal'];assert final['status']=='paused'
  messages=[e['message'] for e in events() if e['event']=='message' and e['message']['role']=='assistant'];late=next(m for m in messages if any(p.get('text','').startswith('LATE_RESPONSE_BEFORE_ACTIVATION') for p in m['content']));assert late['usage']['output']>0
  pause_message=[m for m in messages if any(p.get('type')=='toolCall' and p.get('name')=='update_goal' for p in m['content'])][-1];u=pause_message['usage'];assert final['tokensUsed']==before['tokensUsed']+u['input']+u['output']+u['cacheWrite'],'Old activation response must remain excluded after resume'
 elif scenario=='tools':
  specs=[{'name':'get_goal','args':{}},{'name':'update_goal','args':{'status':'blocked'}},{'name':'create_goal','args':{'objective':'','token_budget':1}},{'name':'create_goal','args':{'objective':'Bad budget','token_budget':0}},{'name':'create_goal','args':{'objective':'Bad budget','token_budget':-1}},{'name':'create_goal','args':{'objective':'Bad budget','token_budget':1.5}},{'name':'create_goal','args':{'objective':'Too long '+('x'*4001)}},{'name':'create_goal','args':{'objective':'Created via real model tool'}},{'name':'create_goal','args':{'objective':'Duplicate rejected'}},{'name':'update_goal','args':{'status':'invalid'}},{'name':'update_goal','args':{'status':'active'}},{'name':'update_goal','args':{'status':'paused'}},{'name':'get_goal','args':{}},{'name':'get_goal','args':{'unexpected':True}}]
  specs.extend([{'name':'create_goal','args':{'objective':'Unsafe budget','token_budget':9007199254740992}},{'name':'create_goal','args':{'objective':'String budget','token_budget':'2'}},{'name':'create_goal','args':{'objective':'Boolean budget','token_budget':True}},{'name':'create_goal','args':{'objective':'Extra argument','extra':True}},{'name':'update_goal','args':{'status':'complete','extra':True}},{'name':'update_goal','args':{'status':'blocked'}},{'name':'update_goal','args':{'status':'complete'}}])
  seed('tools:'+json.dumps(specs,separators=(',',':')));cmd('Exercise tool validation');settled(1)
  a=snap('tool-results');messages=[e['message'] for e in events() if e['event']=='message'];results=[m for m in messages if m['role']=='toolResult']
  assert len(results)==len(specs);assert json.loads(results[0]['content'][0]['text'])['goal'] is None
  assert all(results[i].get('isError') for i in [1,2,3,4,5,6,8,9,10,13,14,15,16,17,18]),[(i,r) for i,r in enumerate(results)]
  assert not any(results[i].get('isError') for i in [0,7,11,12,19,20]);assert own(a)['goal']['objective']=='Created via real model tool';assert own(a)['goal']['status']=='complete'
 elif scenario=='config':
  config=root/'agent'/'goal.json';config.write_text('{"maxGoalTokenBudget":0}')
  cmd('/reload');text('Reloaded');settle();cmd('/goal Config must reject');text('positive safe integer');assert (state('invalid-config') or {}).get('goal') is None
  config.write_text('{"maxGoalTokenBudget":10000}');cmd('/reload');text('Reloaded');settle()
  specs=[{'name':'create_goal','args':{'objective':'Too much','token_budget':10001}},{'name':'create_goal','args':{'objective':'Default budget'}},{'name':'update_goal','args':{'status':'paused'}}]
  seed('tools:'+json.dumps(specs,separators=(',',':')));cmd('Use configured default budget');settled(1)
  a=state('default-budget');assert a['goal']['tokenBudget']==10000;assert a['goal']['objective']=='Default budget'
  results=[e['message'] for e in events() if e['event']=='message' and e['message']['role']=='toolResult'];assert results[0]['isError'] is True
 elif scenario in ('empty','401','length','deferred','quota'):
  seed(scenario);cmd('/goal '+scenario+' final failure');settled(1);settle(.7)
  a=snap('settled-final');assert own(a)['goal']['status']==('usage_limited' if scenario=='quota' else 'blocked')
  if scenario=='empty':assert a['calls']==4,'Initial explicit turn plus three accepted empty automatic turns'
 elif scenario=='missing':
  cmd('/goal Missing tool journey');settled(1);seed('text');cmd('/matrix-tools missing');text('MATRIX_TOOLS missing');cmd('/goal resume');text('Missing goal tools');a=snap('missing-tools');calls=a['calls']
  cmd('Explicit user while missing');settled(2);b=snap('missing-explicit');assert b['calls']==calls+1;assert own(b)['goal']['status']=='paused'
  cmd('/matrix-tools restored');text('MATRIX_TOOLS restored');seed('text');cmd('Restored tools alone must not unlock');settled(3);c=snap('restored-no-resume');assert own(c)['goal']['status']=='paused';assert c['calls']==b['calls']+1
  seed('pause');cmd('/goal resume');settled(4);assert state('missing-resumed')['goal']['status']=='paused'
 else:raise ValueError(scenario)
 quit();(root/'result.json').write_text(json.dumps({'passed':True,'scenario':scenario,'pids':pids}))
finally:
 if status is None:
  os.killpg(pid,signal.SIGTERM)
  end=time.monotonic()+3
  while status is None and time.monotonic()<end:pump()
  if status is None:os.killpg(pid,signal.SIGKILL);os.waitpid(pid,0)
  os.close(fd);transcript.close()
 (root/'actions.json').write_text(json.dumps(actions,ensure_ascii=False,indent=2));(root/'screens.json').write_text(json.dumps(screens,ensure_ascii=False,indent=2))
