// Exercise all three renderers inside the real repository-pinned Pi CLI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export async function smokePty({ run, env, cliArgs }) {
  const quote = value => `"${value.replace(/[\\"$\[\]]/gu, c => `\\${c}`)}"`;
  const phases = [
    ["initial", ""], ["mixed", "/bash-scene mixed"], ["expanded", "\u000f"],
    ["codexExpanded", "/bash-style codex"], ["claudeExpanded", "/bash-style claude"], ["claudeCollapsed", "\u000f"],
    ["codexCollapsed", "\u001b1"], ["claudeShortcut", "\u001b2"],
    ["replay", "/bash-replay"], ["paused", "/bash-pause"], ["settled", "/bash-settle"],
    ["edge", "/bash-scene edge"], ["hybridShortcut", "\u001b3"],
    ["hybridExpanded", "\u000f"], ["hybridCollapsed", "\u000f"],
    ["hybridLong", "/bash-scene long"], ["hybridQueued", "/bash-step"], ["hybridRunning", "/bash-step"],
    ["hybridLongExpanded", "\u000f"], ["hybridRunningCollapsed", "\u000f"], ["hybridSettled", "/bash-settle"],
  ];
  const send = input => input.startsWith("/") ? `send -- "\\025${input}\\r"` : `send -- "${input.replace(/\x1b/gu, "\\033").replace(/\x0f/gu, "\\017")}"`;
  const script = join(run, "cli-smoke.exp");
  writeFileSync(script, `set timeout 15
log_user 0
proc capture {name} {
  log_file -a -noappend "$::env(PI_LAB_SMOKE_RUN)/$name.ansi"
  expect {
    -timeout 2
    -re {.+} { exp_continue -continue_timer }
    timeout {}
    eof { error "CLI exited early during $name" }
  }
  log_file
  puts stderr "Captured $name"
}
spawn -noecho ${[process.execPath, ...cliArgs].map(quote).join(" ")}
stty rows 48 columns 120 < $spawn_out(slave,name)
${phases.map(([name, input]) => `${input ? send(input) : ""}\ncapture ${name}`).join("\n")}
stty rows 30 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow
send -- "\\017"
capture narrowExpanded
send -- "\\025/reload\\r"
capture reload
send -- "\\025\\004"
expect {
  eof {}
  timeout { exec kill -TERM [exp_pid]; expect eof; error "CLI did not exit" }
}
set result [wait]
exit [lindex $result 3]
`);
  const child = spawn("/usr/bin/expect", [script], {
    cwd: join(run, "workspace"), env: { ...env, PI_LAB_SMOKE_RUN: run },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let exited = false;
  let diagnostics = "";
  const cleanup = () => {
    if (!exited && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  };
  process.on("exit", cleanup);
  child.stdout.on("data", data => { diagnostics += data; });
  child.stderr.on("data", data => { diagnostics += data; });
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`PTY smoke timed out: ${diagnostics}`)); }, 90000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { exited = true; clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const read = name => stripVTControlCharacters(readFileSync(join(run, `${name}.ansi`), "utf8"));
    const style = env.PI_BASH_CLI_STYLE;
    assert.match(read("initial"), style === "codex" ? /• Ran git -C/u : style === "claude" ? /⏺ Bash\(git -C/u : /▸ Bash  ✓ \$ git -C/u);
    assert.match(read("initial"), /Read README\.md/u);
    assert.match(read("initial"), /Edited fixture\.ts/u);
    assert.match(read("mixed"), /pnpm test/u);
    if (style === "hybrid") assert.match(read("mixed"), /▸ Bash  ┬ ✓ \$/u);
    else assert.match(read("mixed"), /to expand/u);
    assert.doesNotMatch(read("mixed"), /PASS render-case-08/u);
    assert.match(read("expanded"), /PASS remaining-case-4/u);
    assert.match(read("claudeExpanded"), /Bash\(pnpm test\)/u);
    assert.match(read("claudeExpanded"), /PASS remaining-case-4/u);
    assert.match(read("claudeCollapsed"), /Error: Exit code 1/u);
    assert.match(read("claudeCollapsed"), /to expand/u);
    assert.doesNotMatch(read("claudeCollapsed"), /PASS remaining-case-4/u);
    assert.match(read("codexCollapsed"), /• Ran pnpm test/u);
    assert.match(read("claudeShortcut"), /Bash\(pnpm test\)/u);
    assert.match(read("replay"), /重播/u);
    assert.match(read("paused"), /暂停/u);
    assert.match(read("settled"), /Error: Exit code 1/u);
    assert.match(read("edge"), /Truncated capture/u);
    assert.match(read("hybridShortcut"), /▸ Bash  ┬ ✓ \$/u);
    assert.match(read("hybridExpanded"), /▾ Bash  ┬ ✓ \$/u);
    assert.match(read("hybridCollapsed"), /▸ Bash  ┬ ✓ \$/u);
    assert.doesNotMatch(read("hybridCollapsed"), /1 command|succeeded|to expand/u);
    assert.match(read("hybridLong"), /git diff --check.*\.\.\./u);
    assert.doesNotMatch(read("hybridLong"), /long-command-end|multiline-command-end/u);
    assert.match(read("hybridQueued"), /○ \$ git diff/u);
    assert.match(read("hybridRunning"), /◌ \$ git diff/u);
    assert.match(read("hybridLongExpanded"), /long-command-end/u);
    assert.match(read("hybridLongExpanded"), /multiline-command-end/u);
    assert.match(read("hybridLongExpanded"), /1: [\d.]+s running/u);
    assert.match(read("hybridRunningCollapsed"), /▸ Bash  ┬ ◌ \$/u);
    assert.match(read("hybridSettled"), /▸ Bash  ┬ ✓ \$/u);
    assert.match(read("reload"), /Bash CLI reference/u);
    const all = [...phases.map(([name]) => name), "narrow", "narrowExpanded", "reload"].map(read).join("\n");
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available|This project is not trusted/u);
    console.log(`Real Pi CLI smoke passed (${style}): startup, three styles, expansion, long commands, running states, resize, reload, exit.`);
  } finally {
    cleanup();
    process.off("exit", cleanup);
  }
}
