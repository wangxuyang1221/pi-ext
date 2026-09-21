import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const [host = 'native', mode = 'regular'] = process.argv.slice(2);
assert(['native','codex','combined','reverse'].includes(host));
assert(['regular','fullscreen'].includes(mode));
assert(process.stdin.isTTY && process.stdout.isTTY, 'A terminal is required');
mkdirSync(join(repo,'.tmp'),{recursive:true});
const root = mkdtempSync(join(repo,'.tmp/quit-choice-'));
try {
  for (const name of ['home','agent','workspace','tmp','sessions']) mkdirSync(join(root,name));
  writeFileSync(join(root,'alpha.md'),'---\nname: alpha\ndescription: Alpha fixture\n---\nALPHA_BODY\n');
  writeFileSync(join(root,'agent/settings.json'),JSON.stringify({quietStartup:true,compaction:{enabled:false},cacheWarming:'off',retry:{enabled:false}}));
  const env=Object.fromEntries(['PATH','LANG','LC_ALL','TERM','TERM_PROGRAM','COLORTERM'].flatMap(key=>process.env[key]?[[key,process.env[key]]]:[]));
  Object.assign(env,{HOME:join(root,'home'),TMPDIR:join(root,'tmp'),XDG_CACHE_HOME:join(root,'cache'),PI_CODING_AGENT_DIR:join(root,'agent'),SKILL_PTY_ROOT:root,PI_OFFLINE:'1',PI_TELEMETRY:'0',PI_SKIP_VERSION_CHECK:'1',PI_HARDWARE_CURSOR:'1'});
  const extensions=[join(repo,'extensions/skill-mentions/__tests__/pty-fixture.ts')];
  if(host!=='native') extensions.push(join(repo,'extensions/codex-ui/src/index.ts'));
  if(host==='reverse') extensions.push(join(repo,'extensions/skill-mentions/src/index.ts'));
  extensions.push(join(here,'index.ts'));
  if(host==='combined') extensions.push(join(repo,'extensions/skill-mentions/src/index.ts'));
  const args=[join(repo,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-extensions','--no-context-files','--no-prompt-templates','--no-skills','--no-builtin-tools','--no-approve','--skill',join(root,'alpha.md'),...extensions.flatMap(p=>['-e',p]),'--provider','faux','--model','faux-1','--session-dir',join(root,'sessions'),'--tui-mode',mode];
  console.log(`Prototype root: ${root}`);
  const child=spawnSync(process.execPath,args,{cwd:join(root,'workspace'),env,stdio:'inherit'});
  if(process.env.QUIT_PROBE_REPORT) writeFileSync(process.env.QUIT_PROBE_REPORT,readFileSync(join(root,'events.jsonl')));
  assert.equal(child.status,0,`CLI failed: ${child.error??child.signal??child.status}`);
} finally {
  rmSync(root,{recursive:true,force:true});
  console.log(`Removed prototype root: ${root}`);
}
