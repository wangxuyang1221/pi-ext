// Optional real CLI acceptance. Reuses the repository's existing expect and headless terminal setup.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../../..');
const { Terminal } = createRequire(path.join(repository, 'prototypes/codex-ui-performance/package.json'))('@xterm/headless');
const agent = fs.realpathSync(process.env.WRITE_SMOKE_AGENT_ROOT ?? path.join(repository, 'node_modules/@earendil-works/pi-coding-agent'));
const pkg = JSON.parse(fs.readFileSync(path.join(agent, 'package.json')));
const cli = path.join(agent, pkg.bin.pi);
execFileSync('/usr/bin/expect', ['-v']);
const scratch = path.join(repository, '.scratch');
fs.mkdirSync(scratch, { recursive: true });
const temporary = fs.mkdtempSync(path.join(scratch, 'write-cli-'));
const evidence = { version: pkg.version, cli, cliSha256: createHash('sha256').update(fs.readFileSync(cli)).digest('hex'), samples: [] };
let child;
try {
  for (const mode of ['regular', 'fullscreen']) {
    if (process.env.WRITE_SMOKE_MODE && process.env.WRITE_SMOKE_MODE !== mode) continue;
    const run = path.join(temporary, mode);
    for (const name of ['home', 'agent', 'cache', 'tmp']) fs.mkdirSync(path.join(run, name), { recursive: true });
    fs.writeFileSync(path.join(run, 'agent/settings.json'), JSON.stringify({ theme: 'codex-pi', quietStartup: true,
      defaultProvider: 'write-smoke', defaultModel: 'fixture', terminal: { mode } }));
    fs.writeFileSync(path.join(run, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
    fs.writeFileSync(path.join(run, 'existing.ts'), 'const oldValue = 1;\n');
    fs.writeFileSync(path.join(run, 'edit.ts'), 'const oldEdit = 1;\n');
    fs.writeFileSync(path.join(run, 'large.ts'), 'x'.repeat(1024 * 1024 + 1));
    const session = path.join(run, 'session.jsonl');
    fs.writeFileSync(session, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: run }) + '\n');
    const trace = path.join(run, 'events.jsonl'); fs.writeFileSync(trace, '');
    const script = path.join(run, 'driver.exp');
    fs.writeFileSync(script, String.raw`set timeout 20
log_user 0
proc capture {name seconds} {
  log_file -a -noappend "$::env(WRITE_SMOKE_RUN)/$name.ansi"
  expect {
    -timeout $seconds
    -re {.+} { exp_continue -continue_timer }
    timeout {}
    eof { error "CLI exited early" }
  }
  log_file
}
proc launch {} {
  global spawn_id spawn_out
  spawn -noecho $::env(WRITE_SMOKE_NODE) $::env(WRITE_SMOKE_CLI) --offline --no-approve --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --theme $::env(WRITE_SMOKE_THEME) --use-theme codex-pi --tui-mode $::env(WRITE_SMOKE_MODE) --session $::env(WRITE_SMOKE_SESSION) -e $::env(WRITE_SMOKE_EXTENSION)
  stty rows 60 columns 120 < $spawn_out(slave,name)
}
proc quit {} {
  send -- "\025\004"
  expect { eof {} timeout { exec kill -TERM [exp_pid]; expect eof; error "CLI did not exit" } }
  set result [wait]
  if {[lindex $result 3] != 0} { error "CLI exited with error" }
}
launch
capture initial 2
send -- "Run the local file fixtures.\r"
capture pending 1
send -- "\017"
capture pending-expanded 1
send -- "\017"
capture pending-edit 3
capture completed 5
send -- "\017"
capture expanded 1
stty rows 60 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow 1
send -- "\017"
capture collapsed 1
send -- "/reload\r"
capture reload 2
quit
launch
capture restarted 2
send -- "\017"
capture restored-expanded 1
quit
`);
    const env = { PATH: process.env.PATH, HOME: path.join(run, 'home'), TMPDIR: path.join(run, 'tmp'),
      XDG_CONFIG_HOME: path.join(run, 'home/.config'), XDG_CACHE_HOME: path.join(run, 'cache'),
      PI_CODING_AGENT_DIR: path.join(run, 'agent'), PI_CODING_AGENT_SESSION_DIR: path.join(run, 'agent/sessions'),
      JITI_FS_CACHE: path.join(run, 'cache'), PI_MCP_CONFIG: path.join(run, 'mcp.json'),
      PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', PI_TRUE_COLOR: '1', COLORTERM: 'truecolor', TERM: 'xterm-256color', LANG: 'en_US.UTF-8',
      WRITE_SMOKE_RUN: run, WRITE_SMOKE_TRACE: trace, WRITE_SMOKE_NODE: process.execPath, WRITE_SMOKE_CLI: cli,
      WRITE_SMOKE_MODE: mode, WRITE_SMOKE_SESSION: session, WRITE_SMOKE_EXTENSION: path.join(directory, 'write-cli-fixture.mjs'),
      WRITE_SMOKE_THEME: path.join(repository, 'themes/codex-pi.json') };
    child = spawn('/usr/bin/expect', [script], { cwd: run, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const pid = child.pid;
    let diagnostics = '';
    child.stdout.on('data', data => { diagnostics += data; }); child.stderr.on('data', data => { diagnostics += data; });
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} reject(new Error(`PTY timeout: ${diagnostics}`)); }, 60_000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    let terminal = new Terminal({ cols: 120, rows: 60, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
    const phases = [];
    try {
      for (const phase of ['initial', 'pending', 'pending-expanded', 'pending-edit', 'completed', 'expanded', 'narrow', 'collapsed', 'reload', 'restarted', 'restored-expanded']) {
        if (phase === 'narrow') terminal.resize(60, 60);
        if (phase === 'restarted') { terminal.dispose(); terminal = new Terminal({ cols: 120, rows: 60, scrollback: 10000, allowProposedApi: true, logLevel: 'off' }); }
        const bytes = fs.readFileSync(path.join(run, `${phase}.ansi`));
        if (bytes.length) await new Promise(resolve => terminal.write(bytes, resolve));
        const buffer = terminal.buffer.active;
        const rows = Array.from({ length: terminal.rows }, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? '');
        const markers = [];
        for (let i = 0; i < rows.length; i++) {
          const text = rows[i];
          if (!/(?:Writing|Editing|Added|Edited|failed) /u.test(text)) continue;
          const column = text.search(/[◌•✗]/u);
          if (column < 0) continue;
          const cell = buffer.getLine(buffer.viewportY + i).getCell(column);
          markers.push({ text, dim: cell.isDim(), fg: cell.getFgColor() });
        }
        phases.push({ phase, bytes: bytes.length, visible: rows.join('\n'), markers });
      }
    } finally { terminal.dispose(); }
    const events = fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const entries = fs.readFileSync(session, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const sample = { mode, pid, phases, events, entries };
    evidence.samples.push(sample);
    fs.writeFileSync(path.join(scratch, `write-cli-${pkg.version}.json`), JSON.stringify(evidence, null, 2));
    const view = phase => phases.find(item => item.phase === phase).visible;
    for (const phase of ['pending', 'pending-expanded']) {
      assert.match(view(phase), /◌ Writing\s+new.ts/u, `${mode}/${phase}`);
      assert.doesNotMatch(view(phase), /item0|\+20|more lines/u);
    }
    assert.match(view('pending-edit'), /◌ Editing\s+edit.ts/u);
    for (const phase of ['completed', 'collapsed', 'reload', 'restarted']) {
      assert.match(view(phase), /• Added new.ts \(\+20 -0\)/u, `${mode}/${phase}`);
      assert.match(view(phase), /• Edited existing.ts \(\+1 -1\)/u);
      assert.match(view(phase), /• Edited edit.ts \(\+1 -1\)/u);
      assert.match(view(phase), /✗ Write failed/u);
      assert.match(view(phase), /✗ Edit failed/u);
      assert.match(view(phase), /Diff unavailable/u);
      assert.match(view(phase), /… 8 more lines/u);
      assert.doesNotMatch(view(phase), /item19/u);
    }
    for (const phase of ['expanded', 'narrow', 'restored-expanded']) assert.match(view(phase), /item19/u);
    assert.match(view('completed'), /WRITE-SMOKE-DONE/u);
    const settledMarkers = phases.find(item => item.phase === 'completed').markers;
    for (const marker of settledMarkers.filter(item => /• (?:Added|Edited)/u.test(item.text))) assert.ok(marker.dim);
    const palette = JSON.parse(fs.readFileSync(path.join(repository, 'themes/codex-pi.json')));
    const color = key => parseInt(palette.vars[palette.colors[key]].slice(1), 16);
    for (const marker of settledMarkers.filter(item => item.text.includes('✗'))) assert.equal(marker.fg, color('error'));
    const pendingMarker = phases.find(item => item.phase === 'pending').markers.find(item => item.text.includes('◌ Writing'));
    assert.equal(pendingMarker.fg, color('warning'));
    const ends = events.filter(event => event.type === 'tool_execution_end').sort((a, b) => a.toolCallId.localeCompare(b.toolCallId));
    assert.equal(ends.length, 7);
    assert.deepEqual(ends.map(event => event.isError), [false, false, false, true, true, false, true]);
    const saved = entries.filter(entry => entry.message?.role === 'toolResult');
    assert.equal(saved.length, 7);
    assert.equal(saved.find(entry => entry.message.toolCallId === 'write-smoke-0').message.details.codexWrite.action, 'Added');
    assert.match(saved.find(entry => entry.message.toolCallId === 'write-smoke-2').message.details.codexWrite.patch, /-const oldValue/u);
    assert.equal(fs.readFileSync(path.join(run, 'new.ts'), 'utf8').split('\n').length, 21);
    assert.equal(fs.readFileSync(path.join(run, 'existing.ts'), 'utf8'), 'const newValue = 2;\n');
    assert.equal(fs.readFileSync(path.join(run, 'edit.ts'), 'utf8'), 'const newEdit = 1;\n');
    assert.equal(fs.readFileSync(path.join(run, 'large.ts'), 'utf8'), 'small\n');
    assert.equal(fs.existsSync(path.join(run, 'blocked.ts')), false);
    for (const phase of phases) assert.doesNotMatch(phase.visible, /Failed to load|TypeError|RangeError|ReferenceError/u);
    try { process.kill(-pid, 'SIGKILL'); } catch {} child = undefined;
    console.log(`Passed Pi ${pkg.version} ${mode}: real writes, edit, failure, permission denial, budget fallback, expand, resize, reload and restart`);
  }
} finally {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  fs.rmSync(temporary, { recursive: true, force: true });
}
