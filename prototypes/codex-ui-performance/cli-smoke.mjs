import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xterm from '@xterm/headless';

// Optional local PTY smoke; normal repository tests do not require expect.
execFileSync('/usr/bin/expect', ['-v']);
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const agentRoot = fs.realpathSync(process.env.PI_PERF_AGENT_ROOT ?? path.join(repository, 'node_modules/@earendil-works/pi-coding-agent'));
const pkg = JSON.parse(fs.readFileSync(path.join(agentRoot, 'package.json')));
const cli = path.join(agentRoot, pkg.bin.pi);
fs.mkdirSync(path.join(repository, '.tmp'), { recursive: true });
const temporary = fs.mkdtempSync(path.join(repository, '.tmp/codex-ui-cli-'));
let child;
try {
  for (const name of ['home', 'agent', 'cache', 'tmp']) fs.mkdirSync(path.join(temporary, name));
  fs.writeFileSync(path.join(temporary, 'agent/settings.json'), JSON.stringify({ theme: 'dark', quietStartup: true, terminal: { mode: 'regular' } }));
  const timestamp = new Date(0).toISOString();
  const entries = [{ type: 'session', version: 3, id: randomUUID(), timestamp, cwd: temporary }];
  let parentId = null;
  const append = message => {
    const id = entries.length.toString(16).padStart(8, '0');
    entries.push({ type: 'message', id, parentId, timestamp, message: { timestamp: 0, ...message } });
    parentId = id;
  };
  append({ role: 'user', content: 'Synthetic rendering smoke. Do not execute tools.' });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  append({ role: 'assistant', content: [{ type: 'toolCall', id: 'smoke-bash', name: 'bash', arguments: { command: 'printf smoke-command', timeout: 30 } }],
    model: 'gpt-5.2', provider: 'openai', api: 'openai-responses', stopReason: 'toolUse', usage });
  append({ role: 'toolResult', toolCallId: 'smoke-bash', toolName: 'bash', isError: false,
    content: [{ type: 'text', text: Array.from({ length: 1800 }, (_, index) => index === 1799 ? 'SMOKE-TAIL 中文' : `output ${index}`).join('\n') }] });
  const session = path.join(temporary, 'session.jsonl');
  fs.writeFileSync(session, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const script = path.join(temporary, 'smoke.exp');
  fs.writeFileSync(script, `set timeout 15
log_user 0
proc capture {name} {
  log_file -a -noappend "$::env(PI_SMOKE_DIRECTORY)/$name.ansi"
  expect {
    -timeout 2
    -re {.+} { exp_continue -continue_timer }
    timeout {}
    eof { error "CLI exited early" }
  }
  log_file
  puts stderr "Captured $name"
}
spawn -noecho $env(PI_SMOKE_NODE) $env(PI_SMOKE_CLI) --offline --no-approve --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --theme $env(PI_SMOKE_THEME) --session $env(PI_SMOKE_SESSION) -e $env(PI_SMOKE_EXTENSION)
stty rows 40 columns 120 < $spawn_out(slave,name)
capture initial
send -- "\\017"
capture expanded
send -- "/reload\\r"
capture reload
stty rows 24 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow
send -- "\\017"
capture collapsed
send -- "\\025\\004"
expect {
  eof {}
  timeout { exec kill -TERM [exp_pid]; expect eof; error "CLI did not exit" }
}
set result [wait]
exit [lindex $result 3]
`);
  const env = { PATH: process.env.PATH, HOME: path.join(temporary, 'home'), TMPDIR: path.join(temporary, 'tmp'),
    XDG_CACHE_HOME: path.join(temporary, 'cache'), PI_CODING_AGENT_DIR: path.join(temporary, 'agent'),
    PI_CODING_AGENT_SESSION_DIR: path.join(temporary, 'agent/sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0',
    PI_TRUE_COLOR: '1', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', JITI_FS_CACHE: path.join(temporary, 'cache'),
    PI_SMOKE_DIRECTORY: temporary, PI_SMOKE_NODE: process.execPath, PI_SMOKE_CLI: cli, PI_SMOKE_SESSION: session,
    PI_SMOKE_EXTENSION: path.join(repository, 'extensions/codex-ui/dist/index.js'),
    PI_SMOKE_THEME: path.join(repository, 'themes/codex-pi.json') };
  child = spawn('/usr/bin/expect', [script], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let diagnostics = '';
  child.stdout.on('data', data => { diagnostics += data; });
  child.stderr.on('data', data => { diagnostics += data; });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { process.kill(-child.pid, 'SIGKILL'); reject(new Error(`PTY smoke exceeded 45 seconds: ${diagnostics}`)); }, 45000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); resolve(code); });
  });
  assert.equal(code, 0, diagnostics);
  const terminal = new xterm.Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
  const phases = [];
  try {
    for (const phase of ['initial', 'expanded', 'reload', 'narrow', 'collapsed']) {
      if (phase === 'narrow') terminal.resize(60, 24);
      const data = fs.readFileSync(path.join(temporary, `${phase}.ansi`));
      if (data.length) await new Promise(resolve => terminal.write(data, resolve));
      const buffer = terminal.buffer.active;
      const visible = Array.from({ length: terminal.rows }, (_, index) => buffer.getLine(buffer.viewportY + index)?.translateToString(true) ?? '').join('\n');
      assert.doesNotMatch(visible, /Failed to load|TypeError|RangeError|ReferenceError/u);
      phases.push({ phase, bytes: data.length, visible });
    }
  } finally { terminal.dispose(); }
  assert.match(phases.find(item => item.phase === 'initial').visible, /Bash completed/u);
  assert.match(phases.find(item => item.phase === 'expanded').visible, /SMOKE-TAIL 中文/u);
  assert.match(phases.find(item => item.phase === 'expanded').visible, /1800 lines/u);
  assert.match(phases.find(item => item.phase === 'reload').visible, /Reloaded keybindings/u);
  assert.match(phases.find(item => item.phase === 'narrow').visible, /SMOKE-TAIL 中文/u);
  assert.match(phases.find(item => item.phase === 'collapsed').visible, /Bash completed/u);
  assert.doesNotMatch(phases.find(item => item.phase === 'collapsed').visible, /SMOKE-TAIL/u);
  const runId = process.env.PI_PERF_RUN_ID ?? `cli-smoke-${pkg.version}-${Date.now()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error('Invalid run ID');
  const output = path.join(directory, 'results', runId);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'smoke.json'), JSON.stringify({ agentVersion: pkg.version, cli,
    cliSha256: createHash('sha256').update(fs.readFileSync(cli)).digest('hex'),
    scope: 'Isolated real CLI + expect PTY; restored Bash, toggle, reload, resize, clean exit. No model call, tool execution or Ghostty/GPU measurement.', phases }, null, 2) + '\n');
  console.log(`Passed isolated CLI PTY smoke for Pi ${pkg.version}.`);
} finally {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  fs.rmSync(temporary, { recursive: true, force: true });
}
