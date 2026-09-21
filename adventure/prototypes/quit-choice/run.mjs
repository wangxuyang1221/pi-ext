import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const [host = 'native', mode = 'regular', backend = 'fixture'] = process.argv.slice(2);
const real = ['real','resume','unselected-resume','product','product-resume','product-unselected-resume'].includes(backend);
const repeat = ['resume','unselected-resume','product-resume','product-unselected-resume'].includes(backend);
const product = backend.startsWith('product');
const quote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;
const tmux = real ? spawnSync('/usr/bin/which', ['tmux'], {encoding:'utf8'}).stdout.trim() : '';
assert(!real || tmux, 'tmux is required for the real backend');
assert(['native','codex','combined','reverse'].includes(host));
assert(['regular','fullscreen'].includes(mode));
assert(process.stdin.isTTY && process.stdout.isTTY, 'A terminal is required');
mkdirSync(join(repo,'.tmp'),{recursive:true});
const root = mkdtempSync(join(repo,'.tmp/quit-choice-'));
const tracked = new Set();
let keeperPid;
const directTmux = args => spawnSync(tmux,['-S',join(root,'socket'),'-f','/dev/null',...args],{encoding:'utf8'});
try {
  for (const name of ['home','agent','workspace','tmp','sessions']) mkdirSync(join(root,name));
  writeFileSync(join(root,'alpha.md'),'---\nname: alpha\ndescription: Alpha fixture\n---\nALPHA_BODY\n');
  writeFileSync(join(root,'agent/settings.json'),JSON.stringify({quietStartup:true,compaction:{enabled:false},cacheWarming:'off',retry:{enabled:false}}));
  const env=Object.fromEntries(['PATH','LANG','LC_ALL','TERM','TERM_PROGRAM','COLORTERM'].flatMap(key=>process.env[key]?[[key,process.env[key]]]:[]));
  Object.assign(env,{HOME:join(root,'home'),TMPDIR:join(root,'tmp'),XDG_CACHE_HOME:join(root,'cache'),PI_CODING_AGENT_DIR:join(root,'agent'),SKILL_PTY_ROOT:root,PI_OFFLINE:'1',PI_TELEMETRY:'0',PI_SKIP_VERSION_CHECK:'1',PI_HARDWARE_CURSOR:'1'});
  Object.assign(env,{QUIT_PROBE_REAL:real?'1':'0',QUIT_PROBE_PRODUCT:product?'1':'0',QUIT_PROBE_REPO:repo});
  if(real) {
    writeFileSync(join(root,'tmux'), '#!/bin/sh\nexport LANG=en_US.UTF-8\n' +
      'if [ "$1" = display-message ] && [ -f '+quote(join(root,'fail-query'))+' ]; then echo "Injected tmux query failure" >&2; exit 87; fi\n' +
      'if [ "$1" = kill-window ] && [ -f '+quote(join(root,'fail-close'))+' ] && [ "$3" = "$(cat '+quote(join(root,'fail-close'))+')" ]; then echo "Injected tmux close failure" >&2; exit 88; fi\n' +
      'exec '+quote(tmux)+' -S '+quote(join(root,'socket'))+' -f /dev/null "$@"\n',{mode:0o700});
    writeFileSync(join(root,'pi'),'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(join(repo,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'))+' --offline --no-extensions --no-context-files --no-skills --no-prompt-templates --no-themes --no-builtin-tools --no-approve "$@"\n',{mode:0o700});
    const started=spawnSync(tmux,['-S',join(root,'socket'),'-f','/dev/null','new-session','-d','-s','probe-keeper','-P','-F','#{pid}\t#{pane_pid}','sleep 300'],{env,encoding:'utf8'});
    assert.equal(started.status,0,started.stderr);
    const ids=started.stdout.trim().split('\t').map(Number);ids.forEach(pid=>tracked.add(pid));keeperPid=ids[1];
  }
  const extensions=[join(repo,'extensions/skill-mentions/__tests__/pty-fixture.ts')];
  if(host!=='native') extensions.push(join(repo,'extensions/codex-ui/src/index.ts'));
  if(host==='reverse') extensions.push(join(repo,'extensions/skill-mentions/src/index.ts'));
  extensions.push(join(here,'index.ts'));
  if(host==='combined') extensions.push(join(repo,'extensions/skill-mentions/src/index.ts'));
  const args=[join(repo,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-extensions','--no-context-files','--no-prompt-templates','--no-skills','--no-builtin-tools','--no-approve','--skill',join(root,'alpha.md'),...extensions.flatMap(p=>['-e',p]),'--provider','faux','--model','faux-1','--session-dir',join(root,'sessions'),'--tui-mode',mode];
  console.log(`Prototype root: ${root}`);
  let child;
  for(let run=0;run<(repeat?2:1);run++) {
    child=spawnSync(process.execPath,[...args,...(run?['--continue']:[])],{cwd:join(root,'workspace'),env,stdio:'inherit'});
    appendFileSync(join(root,'events.jsonl'),JSON.stringify({type:'probe-process-exit',data:{run,status:child.status,signal:child.signal}})+'\n');
    if(['unselected-resume','product-unselected-resume'].includes(backend) && run===0) assert(child.status===0 || child.signal==='SIGKILL', `Unexpected first exit: ${child.error??child.signal??child.status}`);
    else assert.equal(child.status,0,`CLI run failed: ${child.error??child.signal??child.status}`);
  }
  const records = readFileSync(join(root,'events.jsonl'),'utf8');
  if(process.env.QUIT_PROBE_REPORT) writeFileSync(process.env.QUIT_PROBE_REPORT,records);
  if(real) {
    const rows=records.trim().split('\n').map(line=>JSON.parse(line));
    const agents=rows.filter(row=>row.type==='probe-spawn').map(row=>row.data);
    for(const agent of agents)tracked.add(agent.tmux.panePid);
    const live = pid => {try{process.kill(pid,0);return true;}catch{return false;}};
    const summary={keeperPid,keeperAlive:live(keeperPid),agents:agents.map(agent=>({agentId:agent.agentId,pid:agent.tmux.panePid,alive:live(agent.tmux.panePid)}))};
    if(process.env.QUIT_PROBE_REPORT)writeFileSync(process.env.QUIT_PROBE_REPORT+'.summary.json',JSON.stringify(summary));
  }
  assert.equal(child.status,0,`CLI failed: ${child.error??child.signal??child.status}`);
 } finally {
  if(real) {
    const panes=directTmux(['list-panes','-a','-F','#{pane_pid}']);
    if(panes.status===0) panes.stdout.trim().split('\n').map(Number).filter(pid=>pid>0).forEach(pid=>tracked.add(pid));
    directTmux(['kill-server']);
    const live=()=>[...tracked].filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
    const deadline=Date.now()+3000;
    while(live().length && Date.now()<deadline)spawnSync('/bin/sleep',['0.05']);
    assert.deepEqual(live(),[],'Probe processes must exit');
    assert.notEqual(directTmux(['list-sessions']).status,0,'Isolated tmux socket must be unavailable');
    if(process.env.QUIT_PROBE_REPORT)writeFileSync(process.env.QUIT_PROBE_REPORT+'.cleanup.json',JSON.stringify({pids:[...tracked],livePids:live(),socketUnavailable:true}));
  }
  rmSync(root,{recursive:true,force:true});
  console.log(`Removed prototype root: ${root}`);
}
