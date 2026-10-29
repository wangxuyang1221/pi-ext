// Real CLI, JSON RPC, builtin tools, and local MCP transport.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessGroup } from '../../../../scripts/codex-compact-quality-process.mjs';
const [root, evidence] = process.argv.slice(2);
assert.ok(root && evidence, 'Use scripts/run.mjs headless');
const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const abort = new AbortController();
const interrupt = () => abort.abort(new Error('Verification interrupted'));
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
mkdirSync(join(root,'sessions'));
writeFileSync(join(root,'agent/settings.json'),JSON.stringify({quietStartup:true,defaultProjectTrust:'never',compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off'}));
const serverLog=join(root,'mcp-events.jsonl');
writeFileSync(join(root,'mcp.json'),JSON.stringify({mcpServers:{alpha:{command:process.execPath,args:[join(here,'mcp-server.mjs'),serverLog,'alpha'],retry:{maxAttempts:1,background:false}}}}));
const children=[],results=[],actions=[];
const calls=()=>existsSync(serverLog)?readFileSync(serverLog,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
async function wait(predicate,label){const end=Date.now()+30000;while(Date.now()<end){abort.signal.throwIfAborted();if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out: '+label);}
function launch(label,extra){
 const workspace=join(root,label);mkdirSync(workspace);writeFileSync(join(workspace,'edit.txt'),'before\n');
 const args=[resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--session-dir',join(root,'sessions'),'--provider','faux','--model','faux-1','-e',process.env.PI_PERMISSIONS_VERIFY_ENTRY ?? resolve('extensions/permissions/src/index.ts'),'-e',join(here,'provider.ts'),'-e',resolve('extensions/mcp/dist/index.js'),...extra];
 const child=spawn(process.execPath,args,{cwd:workspace,detached:true,stdio:['pipe','pipe','pipe'],env:{...env,PI_VERIFY_ROOT:root,PI_PERMISSIONS_MODE:'default',PI_MCP_CONFIG:join(root,'mcp.json')}});
 const run={label,workspace,child,command:[process.execPath,...args],stdout:'',stderr:'',messages:[]};children.push(run);let pending='';
 writeFileSync(join(root,'owned-processes.json'),JSON.stringify(children.map(run=>run.child.pid).filter(Number.isSafeInteger)));
 child.stdout.on('data',b=>{run.stdout+=b;pending+=b;let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);try{run.messages.push(JSON.parse(line));}catch{}}});
 child.stderr.on('data',b=>run.stderr+=b);run.closed=once(child,'close');return run;
}
const tools=[['write',{path:'proof.txt',content:'approved\n'}],['edit',{path:'edit.txt',oldText:'before',newText:'after'}],['bash',{command:"printf 'approved\\n' > bash.txt"}],['mcp__alpha__echo',{text:'approved'}]];
const prompt=(name,args)=>'VERIFY_TOOL '+JSON.stringify({name,args});
function unchanged(run){assert.equal(existsSync(join(run.workspace,'proof.txt')),false);assert.equal(existsSync(join(run.workspace,'bash.txt')),false);assert.equal(readFileSync(join(run.workspace,'edit.txt'),'utf8'),'before\n');}
let passed=false;
const records = () => existsSync(join(root,'events.jsonl')) ? readFileSync(join(root,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
try{
 for(const mode of ['text','json']){
  for(const [tool,args] of tools){
   const before=calls().filter(r=>r.type==='call').length;const eventOffset=records().length;
   const run=launch(`print-${mode}-${tool}`,['--print','--mode',mode,prompt(tool,args)]);run.child.stdin.end();
   await wait(()=>run.child.exitCode!==null,'print exit');await run.closed;assert.equal(run.child.exitCode,0);
   unchanged(run);assert.equal(calls().filter(r=>r.type==='call').length,before);
   const events=records().slice(eventOffset);
   assert.ok(events.some(r=>r.type==='request'&&r.data?.role==='toolResult'&&r.data.toolName===tool&&JSON.stringify(r.data).includes('but no UI is available')));
   results.push({label:run.label,passed:true,sideEffects:false});
  }
  const eventOffset = records().length;
  const run=launch(`upgrade-${mode}`,['--print','--mode',mode,'/permissions full',prompt('write',{path:'proof.txt',content:'wrong\n'})]);run.child.stdin.end();await wait(()=>run.child.exitCode!==null,'upgrade exit');await run.closed;unchanged(run);assert.equal(run.child.exitCode,0);
  const upgradeEvents = records().slice(eventOffset);
  assert.ok(upgradeEvents.some(r => r.type === 'request' && r.data?.role === 'toolResult'
    && r.data.toolName === 'write' && JSON.stringify(r.data).includes('but no UI is available')));
  assert.equal(upgradeEvents.some(r => r.type === 'request' && r.data?.role === 'user'
    && JSON.stringify(r.data.content).includes('/permissions full')), false);
  results.push({label:run.label,passed:true,sideEffects:false});
 }
 const run=launch('rpc',['--mode','rpc']);
 const send=message=>{actions.push(message);run.child.stdin.write(JSON.stringify(message)+'\n');};
 for(const [tool,args] of tools){
  for(const choice of ['Deny','Allow once']){
   const offset=run.messages.length;const count=calls().filter(r=>r.type==='call').length;
   const editBefore=readFileSync(join(run.workspace,'edit.txt'),'utf8');
   send({type:'prompt',id:`${tool}-${choice}`,message:prompt(tool,args)});
   await wait(()=>run.messages.slice(offset).some(m=>m.type==='extension_ui_request'&&m.method==='select'),tool+' select');
   const approval=run.messages.slice(offset).find(m=>m.type==='extension_ui_request'&&m.method==='select');assert.ok(approval.title.includes('Allow Pi to run '+tool+'?'));
   assert.equal(calls().filter(r=>r.type==='call').length,count);
   if(tool==='write')assert.equal(existsSync(join(run.workspace,'proof.txt')),false);
   if(tool==='bash')assert.equal(existsSync(join(run.workspace,'bash.txt')),false);
   assert.equal(readFileSync(join(run.workspace,'edit.txt'),'utf8'),editBefore);
   send({type:'extension_ui_response',id:approval.id,value:choice});
   await wait(()=>run.messages.slice(offset).some(m=>m.type==='agent_end'),tool+' end');
   if(tool==='write')assert.equal(existsSync(join(run.workspace,'proof.txt')),choice==='Allow once');
   if(tool==='bash')assert.equal(existsSync(join(run.workspace,'bash.txt')),choice==='Allow once');
   if(tool==='edit')assert.equal(readFileSync(join(run.workspace,'edit.txt'),'utf8'),choice==='Allow once'?'after\n':'before\n');
   if(tool.startsWith('mcp')) {
    const executed = calls().filter(r => r.type === 'call');
    assert.equal(executed.length,count+(choice==='Allow once'?1:0));
    if(choice==='Allow once') assert.deepEqual(executed.at(-1).args,args);
   }
   if(choice==='Allow once'&&tool==='write')assert.equal(readFileSync(join(run.workspace,'proof.txt'),'utf8'),'approved\n');
   if(choice==='Allow once'&&tool==='bash')assert.equal(readFileSync(join(run.workspace,'bash.txt'),'utf8'),'approved\n');
   results.push({label:tool+'-'+choice,passed:true});
  }
 }
 for (const choice of ['Cancel', 'Yes, continue anyway']) {
  let offset = run.messages.length;
  const id = `full-${choice}`;
  send({ type: 'prompt', id, message: '/permissions full' });
  await wait(() => run.messages.slice(offset).some(m => m.type === 'extension_ui_request'
    && m.title?.includes('Enable Full access?')), 'Full access confirmation');
  const approval = run.messages.slice(offset).find(m => m.type === 'extension_ui_request'
    && m.title?.includes('Enable Full access?'));
  send({ type: 'extension_ui_response', id: approval.id,
    ...(choice === 'Cancel' ? { cancelled: true } : { value: choice }) });
  await wait(() => run.messages.some(m => m.type === 'response' && m.id === id), 'Full access command');
  offset = run.messages.length;
  send({ type: 'prompt', id: `write-${id}`, message: prompt('write', { path: 'upgrade.txt', content: 'full\n' }) });
  if (choice === 'Cancel') {
   await wait(() => run.messages.slice(offset).some(m => m.type === 'extension_ui_request'
     && m.method === 'select'), 'Approval after cancelled upgrade');
   const pending = run.messages.slice(offset).find(m => m.type === 'extension_ui_request'
     && m.method === 'select');
   assert.equal(existsSync(join(run.workspace, 'upgrade.txt')), false);
   send({ type: 'extension_ui_response', id: pending.id, value: 'Deny' });
  }
  await wait(() => run.messages.slice(offset).some(m => m.type === 'agent_end'), 'Write after upgrade');
  if (choice === 'Cancel') assert.equal(existsSync(join(run.workspace, 'upgrade.txt')), false);
  else {
   assert.equal(readFileSync(join(run.workspace, 'upgrade.txt'), 'utf8'), 'full\n');
   assert.equal(run.messages.slice(offset).some(m => m.type === 'extension_ui_request'
     && m.method === 'select'), false);
  }
  results.push({ label: `rpc-full-${choice}`, passed: true });
 }
 run.child.stdin.end();await wait(()=>run.child.exitCode!==null,'RPC EOF');await run.closed;assert.equal(run.child.exitCode,0);passed=true;
}finally{
 for(const run of children){run.cleanup=await stopProcessGroup(run.child);await run.closed;writeFileSync(join(evidence,run.label+'.stdout'),run.stdout);writeFileSync(join(evidence,run.label+'.stderr'),run.stderr);cpSync(run.workspace,join(evidence,run.label),{recursive:true});}
 const serverPids=[...new Set(calls().map(r=>r.pid))];const serverAlive=serverPids.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
 const processStopped=children.every(r=>r.cleanup.groupStopped)&&serverAlive.length===0;
 writeFileSync(join(evidence,'journey.json'),JSON.stringify({passed,processStopped,driver:'permissions-headless',actions,results,serverPids,serverAlive,mcpEvents:calls(),events:records(),processes:children.map(r=>({label:r.label,command:r.command,...r.cleanup}))},null,2));
 cpSync(join(root,'sessions'),join(evidence,'sessions'),{recursive:true});
 cpSync(join(root,'agent'),join(evidence,'agent'),{recursive:true});
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
 writeFileSync(join(evidence,'summary.json'),JSON.stringify({passed,scratch:root,cleanup:processStopped?'removed':'unverified',processStopped},null,2));
 console.log(JSON.stringify({passed,assertions:results.length,processStopped}));assert.ok(processStopped);
}
