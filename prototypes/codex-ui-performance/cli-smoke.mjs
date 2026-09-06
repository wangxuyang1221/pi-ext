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
const samples = [];
let child;
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function fixture(scene, cwd) {
  const timestamp = new Date(0).toISOString();
  const entries = [{ type: 'session', version: 3, id: randomUUID(), timestamp, cwd }];
  let parentId = null;
  const append = message => {
    const id = entries.length.toString(16).padStart(8, '0');
    entries.push({ type: 'message', id, parentId, timestamp, message: { timestamp: 0, ...message } }); parentId = id;
  };
  if (scene === 'live' || scene.startsWith('summary')) return entries;
  append({ role: 'user', content: 'Synthetic rendering smoke. Do not execute tools.' });
  append({ role: 'assistant', content: [
    { type: 'toolCall', id: 'reference-read', name: 'read', arguments: { path: 'README.md' } },
    { type: 'toolCall', id: 'reference-edit', name: 'edit', arguments: { path: 'fixture.ts', edits: [] } },
  ], model: 'fixture', provider: 'grouped-smoke', api: 'openai-responses', stopReason: 'toolUse', usage });
  append({ role: 'toolResult', toolCallId: 'reference-read', toolName: 'read', isError: false, content: [{ type: 'text', text: '# Grouped Bash Prototype' }] });
  append({ role: 'toolResult', toolCallId: 'reference-edit', toolName: 'edit', isError: false, content: [{ type: 'text', text: 'Successfully applied edit.' }] });
  append({ role: 'assistant', content: Array.from({ length: 3 }, (_, index) => ({ type: 'toolCall', id: `smoke-${index}`, name: 'bash', arguments: { command: `printf smoke-command-${index}` } })),
    model: 'fixture', provider: 'grouped-smoke', api: 'openai-responses', stopReason: 'toolUse', usage });
  for (let index = 0; index < 3; index++) {
    const failed = scene === 'mixed' && index === 1;
    const truncated = scene === 'mixed' && index === 2;
    const output = scene === 'long' ? Array.from({ length: 1800 }, (_, line) => line === 1799 ? 'SMOKE-TAIL 中文' : `output ${line}`).join('\n')
      : failed ? 'Error: SMOKE-FAIL\noriginal detail\nthird detail' : `SMOKE-SUCCESS-${index}`;
    append({ role: 'toolResult', toolCallId: `smoke-${index}`, toolName: 'bash', isError: failed,
      content: [{ type: 'text', text: output }], ...(truncated ? { details: { fullOutputPath: '/fixture/captured-output.txt', truncation: { truncated: true } } } : {}) });
  }
  return entries;
}
try {
  for (const mode of ['regular', 'fullscreen']) for (const scene of ['mixed', 'success', 'long', 'live', 'summary', 'summary-custom']) {
    if (process.env.PI_SMOKE_SCENE && process.env.PI_SMOKE_SCENE !== scene) continue;
    const summaryScene = scene.startsWith('summary');
    if (process.env.PI_SMOKE_MODE && process.env.PI_SMOKE_MODE !== mode) continue;
    const run = path.join(temporary, `${mode}-${scene}`);
    for (const name of ['home', 'agent', 'cache', 'tmp']) fs.mkdirSync(path.join(run, name), { recursive: true });
    const customKey = scene === 'mixed' || scene === 'summary-custom';
    const mcpConfig = path.join(run, 'mcp.json');
    if (summaryScene) fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { fixture: {
      command: process.execPath, args: [path.join(repository, 'extensions/mcp/__tests__/fixtures/stdio-mcp-server.mjs')],
      retry: { maxAttempts: 1, background: false },
    } } }));
    fs.writeFileSync(path.join(run, 'agent/settings.json'), JSON.stringify({ theme: 'codex-pi', quietStartup: true,
      defaultProvider: 'grouped-smoke', defaultModel: 'fixture', terminal: { mode } }));
    if (customKey) fs.writeFileSync(path.join(run, 'agent/keybindings.json'), JSON.stringify({ 'app.tools.expand': 'ctrl+g' }));
    const session = path.join(run, 'session.jsonl');
    fs.writeFileSync(session, fixture(scene, run).map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const trace = path.join(run, 'events.jsonl');
    fs.writeFileSync(trace, '');
    const script = path.join(run, 'smoke.exp');
    fs.writeFileSync(script, `set timeout 20
log_user 0
proc capture {name {seconds 2}} {
  log_file -a -noappend "$::env(PI_SMOKE_DIRECTORY)/$name.ansi"
  expect {
    -timeout $seconds
    -re {.+} { exp_continue -continue_timer }
    timeout {}
    eof { error "CLI exited early" }
  }
  log_file
  puts stderr "Captured $name"
}
proc launch {} {
  global spawn_id spawn_out
  spawn -noecho $::env(PI_SMOKE_NODE) $::env(PI_SMOKE_CLI) --offline --no-approve --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --theme $::env(PI_SMOKE_THEME) --use-theme codex-pi --tui-mode $::env(PI_SMOKE_MODE) --session $::env(PI_SMOKE_SESSION) -e $::env(PI_SMOKE_EXTENSION)
  stty rows 40 columns 120 < $spawn_out(slave,name)
}
proc quit {} {
  send -- "\\025\\004"
  expect { eof {} timeout { exec kill -TERM [exp_pid]; expect eof; error "CLI did not exit" } }
  set result [wait]
  if {[lindex $result 3] != 0} { error "CLI exited with error" }
}
launch
capture initial 2
${summaryScene ? 'send -- "Run the local fixture.\\r"\ncapture pending 2\ncapture live 7' : scene === 'live' ? 'send -- "Run the local fixture.\\r"\ncapture live 9' : ''}
${scene === 'success' ? 'send -- "!printf USER-BASH-SMOKE\\r"\ncapture user-bash 3' : ''}
send -- "${customKey ? '\\007' : '\\017'}"
capture expanded
${summaryScene ? '' : 'send -- "/reload\\r"\ncapture reload 2'}
stty rows 24 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow
send -- "${customKey ? '\\007' : '\\017'}"
capture collapsed
${summaryScene ? 'send -- "/reload\\r"\ncapture reload 2' : ''}
quit
launch
capture restarted 2
send -- "${customKey ? '\\007' : '\\017'}"
capture restored-expanded
quit
`);
    const env = { PATH: process.env.PATH, HOME: path.join(run, 'home'), TMPDIR: path.join(run, 'tmp'),
      XDG_CONFIG_HOME: path.join(run, 'home/.config'), XDG_CACHE_HOME: path.join(run, 'cache'),
      PI_CODING_AGENT_DIR: path.join(run, 'agent'), PI_CODING_AGENT_SESSION_DIR: path.join(run, 'agent/sessions'),
      PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', PI_TRUE_COLOR: '1', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', JITI_FS_CACHE: path.join(run, 'cache'),
      PI_SMOKE_DIRECTORY: run, PI_SMOKE_NODE: process.execPath, PI_SMOKE_CLI: cli, PI_SMOKE_SESSION: session,
      ...(summaryScene ? { PI_MCP_CONFIG: mcpConfig, PI_SMOKE_SUMMARY: '1', PI_SMOKE_BASELINE: process.env.PI_SMOKE_BASELINE ?? '0' } : {}),
      PI_SMOKE_TRACE: trace, PI_SMOKE_MODE: mode, PI_SMOKE_EXTENSION: path.join(directory, 'cli-fixture.mjs'),
      PI_SMOKE_THEME: path.join(repository, 'themes/codex-pi.json') };
    child = spawn('/usr/bin/expect', [script], { cwd: run, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let diagnostics = '';
    child.stdout.on('data', data => { diagnostics += data; }); child.stderr.on('data', data => { diagnostics += data; });
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { process.kill(-child.pid, 'SIGKILL'); reject(new Error(`PTY smoke exceeded 60 seconds: ${diagnostics}`)); }, 60000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    let terminal = new xterm.Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
    const phases = [];
    try {
      for (const phase of ['initial', ...(summaryScene ? ['pending', 'live'] : scene === 'live' ? ['live'] : []), ...(scene === 'success' ? ['user-bash'] : []), 'expanded', ...(summaryScene ? ['narrow', 'collapsed', 'reload'] : ['reload', 'narrow', 'collapsed']), 'restarted', 'restored-expanded']) {
        if (phase === 'narrow') terminal.resize(60, 24);
        if (phase === 'restarted') { terminal.dispose(); terminal = new xterm.Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: 'off' }); }
        const data = fs.readFileSync(path.join(run, `${phase}.ansi`));
        if (data.length) await new Promise(resolve => terminal.write(data, resolve));
        const buffer = terminal.buffer.active;
        const visible = Array.from({ length: terminal.rows }, (_, index) => buffer.getLine(buffer.viewportY + index)?.translateToString(true) ?? '').join('\n');
        assert.doesNotMatch(visible, /Failed to load|TypeError|RangeError|ReferenceError/u);
        phases.push({ phase, bytes: data.length, visible });
      }
    } finally { terminal.dispose(); }
    const view = phase => phases.find(item => item.phase === phase).visible;
    const events = fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (summaryScene) {
      fs.writeFileSync(path.join(repository, '.tmp/tool-summary-cli-diagnostic.json'), JSON.stringify({ mode, scene, phases, events }, null, 2));
      const baseline = process.env.PI_SMOKE_BASELINE === '1';
      const reloadMcpRendererRetained = /Called fixture \/ echo/u.test(view('reload'));
      if (baseline) {
        assert.match(view('live'), /Completed/u);
        assert.equal(reloadMcpRendererRetained, false);
        samples.push({ mode, scene, baseline, reloadMcpRendererRetained, phases, events });
        try { process.kill(-child.pid, 'SIGKILL'); } catch {} child = undefined;
        continue;
      }
      assert.match(view('pending'), /Write summary.txt/u);
      assert.doesNotMatch(view('pending'), /Write summary.txt.*lines|Writing|Written/u);
      for (const phase of ['live', 'collapsed', 'restarted']) {
        assert.match(view(phase), /Write summary.txt \(20 lines\)/u, `${mode}/${scene}/${phase}`);
        assert.match(view(phase), /MCP-PREVIEW-0/u);
        assert.doesNotMatch(view(phase), /MCP-EXPANDED-TAIL|Completed|Written/u);
      }
      for (const phase of ['expanded', 'restored-expanded']) assert.match(view(phase), /MCP-EXPANDED-TAIL/u);
      assert.match(view('reload'), /Reloaded keybindings/u);
      assert.equal(fs.readFileSync(path.join(run, 'summary.txt'), 'utf8').split('\n').length, 20);
      const ends = events.filter(event => event.type === 'tool_execution_end');
      assert.equal(ends.length, 3);
      assert.deepEqual([...ends].sort((a, b) => a.toolCallId.localeCompare(b.toolCallId)).map(event => event.isError), [false, true, false]);
      samples.push({ mode, scene, customKey, reloadMcpRendererRetained, phases, events });
      console.log(`Passed CLI ${pkg.version}: ${mode}/${scene}`);
      try { process.kill(-child.pid, 'SIGKILL'); } catch {} child = undefined;
      continue;
    }
    const summary = scene === 'mixed' || scene === 'live' ? /3 commands · 2 succeeded · 1 failed/u : /3 commands · 3 succeeded/u;
    for (const phase of [scene === 'live' ? 'live' : 'initial', 'collapsed', 'restarted']) assert.match(view(phase), summary, `${mode}/${scene}/${phase}`);
    if (scene !== 'live') {
      for (const phase of ['initial', 'collapsed', 'restarted']) {
        for (let index = 0; index < 3; index++) assert.ok(view(phase).includes(`printf smoke-command-${index}`), `${mode}/${scene}/${phase}/command-${index}`);
        assert.doesNotMatch(view(phase), /SMOKE-SUCCESS|Error: SMOKE-FAIL|original detail/u);
      }
      const lines = view('initial').split('\n');
      const column = lines.find(line => line.includes('Bash ·')).indexOf('Bash');
      assert.equal(column, 2);
      assert.equal(lines.find(line => line.includes('Read README.md')).indexOf('Read'), column);
      assert.equal(lines.find(line => line.includes('Edited fixture.ts')).indexOf('Edited'), column);
    }
    if (scene === 'success') {
      assert.match(view('user-bash'), /USER-BASH-SMOKE/u);
      const persisted = fs.readFileSync(session, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const execution = persisted.find(entry => entry.message?.role === 'bashExecution')?.message;
      assert.equal(execution?.output, 'USER-BASH-SMOKE');
      assert.equal(execution?.exitCode, 0);
    }
    if (customKey) assert.match(view('initial'), /ctrl\+g/iu);
    assert.match(view('reload'), /Reloaded keybindings/u);
    assert.doesNotMatch(view('restored-expanded'), /\d+\.\d+s/u);
    if (scene === 'long') {
      for (const phase of ['expanded', 'narrow', 'restored-expanded']) assert.match(view(phase), /SMOKE-TAIL 中文/u, `${mode}/${scene}/${phase}; bytes=${phases.find(item => item.phase === phase).bytes}`);
      assert.doesNotMatch(view('collapsed'), /SMOKE-TAIL/u);
    }
    if (scene === 'mixed') {
      assert.doesNotMatch(view('initial'), /Error: SMOKE-FAIL/u);
      assert.match(view('expanded'), /Error: SMOKE-FAIL/u);
      assert.match(view('initial'), /Truncated capture.*\/fixture\/captured-output.txt/u);
      assert.doesNotMatch(view('initial'), /third detail/u);
    }
    if (scene === 'live') {
      assert.equal(events.filter(event => event.type === 'tool_execution_start').length, 3);
      assert.equal(events.filter(event => event.type === 'tool_execution_end').length, 3);
      assert.ok(events.some(event => event.type === 'tool_execution_update'));
      const ends = events.filter(event => event.type === 'tool_execution_end');
      assert.deepEqual([...ends].sort((a, b) => a.toolCallId.localeCompare(b.toolCallId)).map(event => event.isError), [false, false, true]);
      const source = events.find(event => event.type === 'message_end' && event.message?.role === 'assistant' && event.message.content?.some(block => block.type === 'toolCall'));
      assert.deepEqual(source.message.content.map(block => block.id), ['live-bash-0', 'live-bash-1', 'live-bash-2']);
      assert.ok(events.findIndex(event => event.type === 'message_update') < events.findIndex(event => event.type === 'tool_execution_start'));
      assert.match(view('live'), /LIVE-DONE/u);
    } else assert.equal(events.filter(event => event.type === 'tool_execution_start').length, 0);
    samples.push({ mode, scene, customKey, phases, events });
    console.log(`Passed CLI ${pkg.version}: ${mode}/${scene}`);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {} child = undefined;
  }
  const runId = process.env.PI_PERF_RUN_ID ?? `cli-smoke-${pkg.version}-${Date.now()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error('Invalid run ID');
  const output = path.join(directory, 'results', runId); fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'smoke.json'), JSON.stringify({ agentVersion: pkg.version, cli,
    cliSha256: createHash('sha256').update(fs.readFileSync(cli)).digest('hex'),
    productionHashes: Object.fromEntries(['codex-ui', 'mcp'].map(name => [name, Object.fromEntries(
      fs.readdirSync(path.join(repository, 'extensions', name, 'src')).filter(file => file.endsWith('.ts')).sort()
        .map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(repository, 'extensions', name, 'src', file))).digest('hex')]))])),
    fixtureSha256: createHash('sha256').update(fs.readFileSync(path.join(directory, 'cli-fixture.mjs'))).digest('hex'),
    scope: 'Isolated real CLI + PTY, production dist, offline scripted provider, official harmless Bash. Regular/fullscreen, mixed/success/long/live, native/custom toggle, reload, resize, process restart with same session. No network or Ghostty/GPU measurement.', samples }, null, 2) + '\n');
} finally {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  fs.rmSync(temporary, { recursive: true, force: true });
}
