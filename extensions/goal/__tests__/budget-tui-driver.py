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
  os.execvp('node',['node','extensions/goal/__tests__/budget-tui.mjs',sys.argv[2]])
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
scenario=os.environ.get('GOAL_BUDGET_SCENARIO','soft')
try:
 start(scenario);wait(lambda:any(e['event']=='ready' for e in events()),'ready');settle()
 cmd('Explicitly create the goal' if scenario=='baseline' else '/goal Budget TUI fixture')
 if scenario=='interrupt':
  wait(lambda:any(e['event']=='waiting_wrap' for e in events()),'wrap waiting');send(b'\x1b')
 wait(lambda:any(e['event']=='settled' for e in events()),'settled');settle()
 cmd('/goal');text('Tokens used:');screens['first-details']=view();send(b'\x1b');wait(lambda:'opening snapshot' not in view(),'closed details');settle()
 cmd('/goal edit');text('Edit goal');screens['edit']=view();send(b'\x1b');wait(lambda:'Edit goal' not in view(),'closed editor');settle()
 if scenario in ('soft','baseline','interrupt'):cmd('/goal resume');settle()
 cmd('/reload');wait(lambda:sum(e['event']=='ready' for e in events())==2,'reloaded');text('Reloaded keybindings');settle()
 cmd('/goal');text('Tokens used:');screens['reloaded-details']=view();send(b'\x1b');wait(lambda:'opening snapshot' not in view(),'closed reloaded details');settle()
 cmd('/budget-exit');wait(lambda:status is not None,'exit');assert os.waitstatus_to_exitcode(status)==0
 records = [json.loads(line) for line in (root / "events.jsonl").read_text().splitlines()]
 result = next(row for row in records if row["event"] == "result")
 assert result["networkAttempts"] == 0
 assert result["calls"] == (3 if scenario == "baseline" else 2)
 assert result["readyCount"] == 2
 first = next(row for row in records if row["event"] == "settled")
 if scenario == "interrupt":
  assert first["goal"]["status"] == "budget_limited"
  assert first["calls"] == result["calls"] == 2, "Esc must cancel wrap-up without starting another turn"
  assert any(row["event"] == "assistant" and row["message"].get("stopReason") == "aborted" for row in records)
 assert result["goal"]["tokensUsed"] == (100 if scenario in ("quota", "interrupt") else 110)
 assert result["goal"]["tokenBudget"] == 100
 assert result["goal"]["objective"] == ("Explicit baseline goal" if scenario == "baseline" else "Budget TUI fixture")
 assert result["goal"]["status"] == ("usage_limited" if scenario == "quota" else "budget_limited")
 budget_contexts = [message for row in records if row["event"] == "context" for message in row["messages"] if message.get("customType") == "pi-ext-goal-budget"]
 assert len(budget_contexts) == 1, "Exactly one wrap-up prompt must reach model context"
 terminal = (root / f"terminal-{scenario}.ansi").read_text(errors="replace")
 assert "Tokens used:" in terminal and "Edit goal" in terminal
 if scenario in ("quota", "interrupt"):
  assert result["goal"]["usageIncomplete"] is True
  assert "usage is incomplete" in terminal
 summary = {"pid": pid, "exited": True, "version": result["version"], "scenario": scenario, "calls": result["calls"], "goal": result["goal"], "networkAttempts": 0, "passed": True}
 (root / "result.json").write_text(json.dumps(summary, indent=2))
 print(json.dumps(summary, indent=2))
finally:
 if status is None:
  os.killpg(pid,signal.SIGTERM)
  end=time.monotonic()+3
  while status is None and time.monotonic()<end:pump()
  if status is None:os.killpg(pid,signal.SIGKILL);os.waitpid(pid,0)
 os.close(fd);transcript.close()
 (root/'actions.json').write_text(json.dumps(actions,ensure_ascii=False,indent=2));(root/'screens.json').write_text(json.dumps(screens,ensure_ascii=False,indent=2))
