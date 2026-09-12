// Real production CLI acceptance with isolated state and an offline scripted provider.
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
const agent = fs.realpathSync(path.join(repository, 'node_modules/@earendil-works/pi-coding-agent'));
const pkg = JSON.parse(fs.readFileSync(path.join(agent, 'package.json')));
const cli = path.join(agent, pkg.bin.pi);
execFileSync('/usr/bin/expect', ['-v']);
const evidenceDirectory = path.join(repository, '.scratch/claude-bash/cli');
fs.mkdirSync(evidenceDirectory, { recursive: true });
const temporary = fs.mkdtempSync(path.join(evidenceDirectory, 'run-'));
const evidence = { version: pkg.version, cli, cliSha256: createHash('sha256').update(fs.readFileSync(cli)).digest('hex'), samples: [] };
let child;
try {
  for (const mode of ['regular', 'fullscreen']) {
    if (process.env.BASH_SMOKE_MODE && process.env.BASH_SMOKE_MODE !== mode) continue;
    const run = path.join(temporary, mode);
    for (const name of ['home', 'agent', 'cache', 'tmp']) fs.mkdirSync(path.join(run, name), { recursive: true });
    fs.writeFileSync(path.join(run, 'agent/settings.json'), JSON.stringify({ theme: 'codex-pi', quietStartup: true, defaultProvider: 'bash-smoke', defaultModel: 'fixture', compaction: { enabled: false, keepRecentTokens: 1 }, terminal: { mode } }));
    fs.writeFileSync(path.join(run, 'existing.txt'), 'old\n');
    const session = path.join(run, 'session.jsonl');
    fs.writeFileSync(session, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: run }) + '\n');
    const trace = path.join(run, 'events.jsonl'); fs.writeFileSync(trace, '');
    const script = path.join(run, 'driver.exp');
    fs.writeFileSync(script, String.raw`set timeout 25
log_user 0
proc capture {name seconds} {
  log_file -a -noappend "$::env(BASH_SMOKE_RUN)/$name.ansi"
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
  spawn -noecho $::env(BASH_SMOKE_NODE) $::env(BASH_SMOKE_CLI) --offline --no-approve --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --theme $::env(BASH_SMOKE_THEME) --use-theme codex-pi --tui-mode $::env(BASH_SMOKE_MODE) --session $::env(BASH_SMOKE_SESSION) -e $::env(BASH_SMOKE_EXTENSION)
  stty rows 100 columns 120 < $spawn_out(slave,name)
}
proc quit {} {
  send -- "\025\004"
  expect { eof {} timeout { exec kill -TERM [exp_pid]; expect eof; error "CLI did not exit" } }
  set result [wait]
  if {[lindex $result 3] != 0} { error "CLI exited with error" }
}
launch
capture initial 2
send -- "run\r"
capture pending 1
capture running 2
send -- "\017"
capture running-expanded 1
if {$::env(BASH_SMOKE_MODE) eq "fullscreen"} { send -- "\033\133H" }
capture expanded-top 1
if {$::env(BASH_SMOKE_MODE) eq "fullscreen"} { send -- "\033\133F" }
capture expanded-bottom 1
send -- "\017"
capture completed 5
send -- "\017"
capture expanded 1
stty rows 100 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow 1
send -- "\017"
capture collapsed 1
stty rows 100 columns 120 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture wide 1
send -- "/reload\r"
capture reload 2
quit
launch
capture restarted 2
send -- "\017"
capture restored-expanded 1
send -- "\017"
capture restored-collapsed 1
send -- "cancel\r"
capture cancelling 2
send -- "\033"
capture cancelled 2
send -- "!printf USER-BASH-UNCHANGED\r"
capture user-bash 2
send -- "/lowpower on\r"
capture low-on 1
send -- "low\r"
capture low-result 2
send -- "/lowpower off\r"
capture low-off 1
send -- "/fixture-tree cut\r"
capture tree-cut 2
send -- "/fixture-tree restore\r"
capture tree-restored 2
send -- "/fixture-fork\r"
capture fork 2
send -- "/compact\r"
capture compacted 2
send -- "/reload\r"
capture compacted-reload 2
quit
`);
    const env = { PATH: process.env.PATH, HOME: path.join(run, 'home'), TMPDIR: path.join(run, 'tmp'),
      XDG_CONFIG_HOME: path.join(run, 'home/.config'), XDG_CACHE_HOME: path.join(run, 'cache'),
      PI_CODING_AGENT_DIR: path.join(run, 'agent'), PI_CODING_AGENT_SESSION_DIR: path.join(run, 'agent/sessions'), JITI_FS_CACHE: path.join(run, 'cache'),
      PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', PI_TRUE_COLOR: '1', COLORTERM: 'truecolor', TERM: 'xterm-256color', LANG: 'en_US.UTF-8',
      BASH_SMOKE_RUN: run, BASH_SMOKE_TRACE: trace, BASH_SMOKE_NODE: process.execPath, BASH_SMOKE_CLI: cli,
      BASH_SMOKE_MODE: mode, BASH_SMOKE_SESSION: session, BASH_SMOKE_EXTENSION: path.join(directory, 'bash-cli-fixture.mjs'), BASH_SMOKE_THEME: path.join(repository, 'themes/codex-pi.json') };
    child = spawn('/usr/bin/expect', [script], { cwd: run, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const pid = child.pid; let diagnostics = '';
    child.stdout.on('data', data => { diagnostics += data; }); child.stderr.on('data', data => { diagnostics += data; });
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} reject(new Error(`PTY timeout: ${diagnostics}`)); }, 90_000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const names = ['initial', 'pending', 'running', 'running-expanded', 'expanded-top', 'expanded-bottom', 'completed', 'expanded', 'narrow', 'collapsed', 'wide', 'reload', 'restarted', 'restored-expanded', 'restored-collapsed', 'cancelling', 'cancelled', 'user-bash', 'low-on', 'low-result', 'low-off', 'tree-cut', 'tree-restored', 'fork', 'compacted', 'compacted-reload'];
    let terminal = new Terminal({ cols: 120, rows: 100, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
    const phases = [];
    try {
      for (const phase of names) {
        if (phase === 'narrow') terminal.resize(60, 100);
        if (phase === 'wide') terminal.resize(120, 100);
        if (phase === 'restarted') { terminal.dispose(); terminal = new Terminal({ cols: 120, rows: 100, scrollback: 10000, allowProposedApi: true, logLevel: 'off' }); }
        const bytes = fs.readFileSync(path.join(run, `${phase}.ansi`));
        fs.copyFileSync(path.join(run, `${phase}.ansi`), path.join(evidenceDirectory, `${mode}-${phase}.ansi`));
        if (bytes.length) await new Promise(resolve => terminal.write(bytes, resolve));
        const buffer = terminal.buffer.active;
        const rows = Array.from({ length: terminal.rows }, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? '');
        const all = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? '');
        const markers = [];
        for (let i = 0; i < rows.length; i++) {
          const column = rows[i].indexOf('⏺');
          if (column < 0) continue;
          const cell = buffer.getLine(buffer.viewportY + i).getCell(column);
          markers.push({ text: rows[i], fg: cell.getFgColor() });
        }
        phases.push({ phase, bytes: bytes.length, visible: rows.join('\n'), transcript: all.join('\n'), markers });
      }
    } finally { terminal.dispose(); }
    const events = fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const entries = fs.readFileSync(session, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const finalSessionFile = events.filter(event => event.type === 'session-path').at(-1).file;
    const forkEntries = fs.readFileSync(finalSessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    evidence.samples.push({ mode, pid, phases, events, entries, finalSessionFile, forkEntries });
    fs.writeFileSync(path.join(evidenceDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2));
    const view = phase => phases.find(item => item.phase === phase).visible;
    assert.doesNotMatch(view('pending'), /⏺ Bash\(/u);
    assert.match(view('running'), /first/u);
    assert.match(view('running'), /… \+1 lines \(ctrl\+o to expand\)/u);
    assert.match(phases.find(item => item.phase === 'expanded-top').transcript, /END-COMMAND/u);
    for (const phase of ['completed', 'wide', 'reload', 'restarted', 'restored-collapsed']) {
      const text = view(phase);
      assert.match(text, /… \+2 lines \(ctrl\+o to expand\)/u, `${mode}/${phase}`);
      assert.match(text, /Error: Exit code 7/u);
      assert.match(text, /Error: Command timed out after 0.2 seconds/u);
      assert.match(text, /Truncated capture/u);
      assert.match(text, /Fixture permission denied/u);
      assert.match(text, /\(No content\)/u);
      assert.doesNotMatch(text, /commands.*succeeded|\$ printf/u);
    }
    for (const phase of ['expanded', 'narrow', 'restored-expanded']) assert.match(view(phase), /2100/u);
    assert.match(view('cancelled'), /Interrupted/u);
    assert.match(view('user-bash'), /USER-BASH-UNCHANGED/u);
    assert.match(view('low-result'), /Bash completed/u);
    assert.match(view('tree-cut'), /first/u);
    assert.doesNotMatch(view('tree-cut'), /Error: Exit code 7|Interrupted|low-power-output/u);
    for (const phase of ['tree-restored', 'fork']) assert.match(view(phase), /Error: Exit code 7/u);
    for (const phase of ['compacted', 'compacted-reload']) {
      assert.match(view(phase), /\[compaction\]/u);
      assert.match(view(phase), /low-power-output/u);
      assert.doesNotMatch(view(phase), /Error: Exit code 7|Interrupted|failure-one/u);
    }
    assert.notEqual(finalSessionFile, session);
    assert.equal(forkEntries.filter(entry => entry.type === 'compaction').length, 1);
    assert.equal(forkEntries.find(entry => entry.type === 'compaction').summary, 'BASH-SMOKE-COMPACTED');
    assert.equal(events.filter(event => event.type === 'session_tree').length, 2);
    assert.equal(events.filter(event => event.type === 'session_start' && event.reason === 'fork').length, 1);
    const saved = entries.filter(entry => entry.message?.role === 'toolResult').map(entry => entry.message);
    assert.equal(saved.length, 12);
    for (const message of saved) {
      const event = events.find(event => event.type === 'tool_execution_end' && event.toolCallId === message.toolCallId);
      assert.deepEqual(message.content, event.result.content);
      assert.deepEqual(message.details ?? {}, event.result.details ?? {});
      assert.equal(message.isError, event.isError);
    }
    for (const event of events.filter(event => event.type === 'provider-captures')) for (const message of event.results) {
      const original = saved.find(item => item.toolCallId === message.toolCallId);
      assert.deepEqual(message.content, original.content);
    }
    assert.equal(saved.find(item => item.toolCallId === 'bash-smoke-run-1').content[0].text, '(no output)');
    assert.match(saved.find(item => item.toolCallId === 'bash-smoke-run-2').content[0].text, /Command exited with code 7$/u);
    assert.match(saved.find(item => item.toolCallId === 'bash-smoke-run-3').content[0].text, /Command timed out after 0.2 seconds$/u);
    assert.equal(saved.find(item => item.toolCallId === 'bash-smoke-run-4').details.truncation.truncated, true);
    assert.deepEqual(saved.find(item => item.toolCallId === 'bash-smoke-run-5').details, {});
    assert.match(saved.find(item => item.toolCallId === 'bash-smoke-cancel-0').content[0].text, /Command aborted$/u);
    assert.equal(events.filter(event => event.type === 'tool_execution_start').length, 12);
    assert.equal(entries.filter(entry => entry.message?.role === 'bashExecution').length, 1);
    assert.equal(fs.readFileSync(path.join(run, 'created.txt'), 'utf8'), 'written\n');
    assert.equal(fs.readFileSync(path.join(run, 'existing.txt'), 'utf8'), 'new\n');
    for (const phase of phases) assert.doesNotMatch(phase.visible, /Failed to load|TypeError|RangeError|ReferenceError/u);
    const palette = JSON.parse(fs.readFileSync(path.join(repository, 'themes/codex-pi.json')));
    const color = key => parseInt(palette.vars[palette.colors[key]].slice(1), 16);
    const marks = phases.find(item => item.phase === 'completed').markers;
    assert.equal(marks.find(item => item.text.includes('Bash(true)')).fg, color('success'));
    assert.equal(marks.find(item => item.text.includes('failure-one')).fg, color('error'));
    assert.equal(marks.find(item => item.text.includes('timeout-before')).fg, color('warning'));
    try { process.kill(-pid, 'SIGKILL'); } catch {} child = undefined;
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
    evidence.samples.at(-1).verified = true;
    evidence.samples.at(-1).driverExited = true;
    console.log(`Passed Pi ${pkg.version} ${mode}: execution, failure, timeout, cancellation, truncation, permissions, low-power, user Bash, expansion, resize, reload, restart, tree, fork, compaction and cleanup`);
  }
} finally {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  fs.rmSync(temporary, { recursive: true, force: true });
  evidence.workspaceRemoved = !fs.existsSync(temporary);
  fs.writeFileSync(path.join(evidenceDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
