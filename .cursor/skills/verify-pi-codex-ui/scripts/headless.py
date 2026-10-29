#!/usr/bin/env -S conda run --no-capture-output -n codex-py312 python
"""Exercise CLI print/json and RPC, not SDK mode flags."""
import json, os, select, shutil, signal, struct, subprocess, tempfile, time, traceback, zlib, base64
from pathlib import Path
from health import doctor
BASE=Path(__file__).resolve().parent
REPO=BASE.parents[3]
EVIDENCE=REPO/'.tmp/test-results'/('codex-ui-headless-'+str(time.time_ns())); EVIDENCE.mkdir(parents=True)
ROOT=Path(tempfile.mkdtemp(prefix='scratch-',dir=EVIDENCE))
results=[]
def interrupt_owned_driver(signum, _frame):
    raise KeyboardInterrupt('Owned driver interrupted by signal '+str(signum))
for owned_signal in [signal.SIGTERM,signal.SIGHUP]:signal.signal(owned_signal,interrupt_owned_driver)
def png():
    def chunk(name,data):
        content=name+data
        return struct.pack('>I',len(data))+content+struct.pack('>I',zlib.crc32(content))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',4000,40,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes((4000*3+1)*40)))+chunk(b'IEND',b'')
passed=False
try:
    for mode in ['print','rpc']:
        for scenario,resize in [('healthy',False),('healthy',True),('global-broken',False),('project-broken',False),('global-unreadable',False),('project-unreadable',False)]:
            label=f'{mode}-{scenario}-{resize}'
            preflight=doctor(REPO,EVIDENCE,label)
            root=ROOT/label; root.mkdir()
            for name in ['home','agent','workspace','sessions','tmp','config','cache','state','data']: (root/name).mkdir()
            (root/'workspace/.pi').mkdir()
            (root/'workspace/.pi/settings.json').write_text('{broken untrusted project settings')
            (root/'workspace/wide.png').write_bytes(png())
            shell=root/'shell';shell.write_text('#!/bin/sh\nexport AUDIT_SHELL=wrapper\nexec /bin/bash "$@"\n');shell.chmod(0o755)
            (root/'agent/settings.json').write_text(json.dumps({'quietStartup':True,'defaultProjectTrust':'never','compaction':{'enabled':False},'retry':{'enabled':False},'cacheWarming':'off','shellCommandPrefix':'export AUDIT_PREFIX=headless','shellPath':str(shell),'images':{'autoResize':resize}}))
            if scenario.startswith('project-'): (root/'workspace/.pi/settings.json').write_text('{}')
            damaged=root/('agent/settings.json' if scenario.startswith('global-') else 'workspace/.pi/settings.json')
            if scenario.endswith('broken'): damaged.write_text('{broken')
            if scenario.endswith('unreadable'): damaged.chmod(0)
            (root/'plan.json').write_text(json.dumps({'calls':[{'name':'bash','arguments':{'command':'printf "%s:%s" "$AUDIT_PREFIX" "$AUDIT_SHELL" > headless.txt; cat headless.txt'}},{'name':'read','arguments':{'path':'wide.png'}}],'reply':'HEADLESS-DONE'}))
            env={k:v for k,v in os.environ.items() if k in ['PATH','LANG','LC_ALL','TZ']}
            env.update(HOME=str(root/'home'),TMPDIR=str(root/'tmp'),PI_CODING_AGENT_DIR=str(root/'agent'),AUDIT_ROOT=str(root),PI_OFFLINE='1',PI_TELEMETRY='0',PI_SKIP_VERSION_CHECK='1')
            for kind in ['CACHE','CONFIG','DATA','STATE']:env['XDG_'+kind+'_HOME']=str(root/kind.lower())
            args=['node',str(REPO/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--session-dir',str(root/'sessions'),'--provider','faux','--model','faux-1','-e',str(REPO/'extensions/codex-ui/dist/index.js'),'-e',str(BASE/'model-provider.ts'),'--mode','json' if mode=='print' else 'rpc']
            if mode=='print':args+=['--print','Execute audit tools']
            if scenario.startswith('project-'): args+=['--approve']
            log=(EVIDENCE/(label+'.jsonl')).open('wb');err=(EVIDENCE/(label+'.stderr')).open('wb')
            p=subprocess.Popen(args,cwd=root/'workspace',env=env,stdin=subprocess.PIPE,stdout=log,stderr=err,start_new_session=True)
            owned={'pid':p.pid,'command':args,'mode':mode,'autoResize':resize,'doctor':preflight}
            results.append(owned)
            try:
                if mode=='rpc':
                    p.stdin.write(b'{"id":"audit","type":"prompt","message":"Execute audit tools"}\n');p.stdin.flush()
                    deadline=time.monotonic()+30
                    while time.monotonic()<deadline:
                        path=root/'events.jsonl'
                        if path.exists() and any(json.loads(s)['type']=='agent_settled' for s in path.read_text().splitlines()): break
                        if p.poll() is not None:break
                        time.sleep(.1)
                    else:raise AssertionError('RPC did not settle')
                else:
                    p.stdin.close()
                    assert p.wait(timeout=30)==0,'print CLI failed'
                events=[json.loads(s) for s in (root/'events.jsonl').read_text().splitlines()]
                tools=[e['data'] for e in events if e['type']=='tool_execution_end']
                assert len(tools)==2,'Both real tools must execute through the host'
                if scenario!='healthy':
                    assert all(e['isError'] for e in tools),'Damaged settings must block both real tools'
                    assert 'execution settings' in json.dumps(tools),'Blocked results must explain the settings scope'
                    assert not (root/'workspace/headless.txt').exists(),'Blocked bash must not create its marker'
                    assert all(b['type']!='image' for e in tools for b in e['result']['content']),'Blocked read must not expose image bytes'
                    owned.update(passed=True,scenario=scenario,sideEffectAbsent=True)
                    (EVIDENCE/(label+'-events.json')).write_text(json.dumps(events,ensure_ascii=False,indent=2))
                    continue
                assert (root/'workspace/headless.txt').read_text()=='headless:wrapper','Headless execution ignored settings'
                image=next(b for e in tools if e['toolName']=='read' for b in e['result']['content'] if b['type']=='image')
                image_bytes=base64.b64decode(image['data'])
                dims=struct.unpack('>II',image_bytes[16:24])
                assert dims==((2000,20) if resize else (4000,40)),str(dims)
                owned.update(passed=True,imageDimensions=dims,fileContent='headless:wrapper')
                (EVIDENCE/(label+'-events.json')).write_text(json.dumps(events,ensure_ascii=False,indent=2))
            finally:
                if p.poll() is None:
                    os.killpg(p.pid,signal.SIGTERM)
                    try:p.wait(timeout=5)
                    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
                p.stdin.close();log.close();err.close()
                owned['exitCode']=p.returncode
                owned['stopped']=subprocess.run(['kill','-0',str(p.pid)],capture_output=True).returncode!=0
                try:os.killpg(p.pid,0);group_stopped=False
                except ProcessLookupError:group_stopped=True
                owned['groupStopped']=group_stopped
                damaged.chmod(0o600)
                assert owned['stopped'] and owned['groupStopped']
    passed=True
except Exception:
    (EVIDENCE/'failure.txt').write_text(traceback.format_exc());print(traceback.format_exc())
finally:
    if all(p.get('stopped') and p.get('groupStopped') for p in results):shutil.rmtree(ROOT)
    else:passed=False
    (EVIDENCE/'summary.json').write_text(json.dumps({'passed':passed,'layer':'native print/json and RPC; offline model boundary; real bash/read/files','cases':results,'scratchRemoved':not ROOT.exists()},indent=2))
    print(json.dumps({'passed':passed,'evidence':str(EVIDENCE)}))
raise SystemExit(0 if passed else 1)
