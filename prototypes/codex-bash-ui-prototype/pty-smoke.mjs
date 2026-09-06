// Optional real-CLI smoke. Renderer tests separately assert the complete terminal-width contract.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export async function smokePty({ run, env, cliArgs }) {
  execFileSync("/usr/bin/expect", ["-v"]);
  const quote = value => `"${value.replace(/[\\"$\[\]]/gu, character => `\\${character}`)}"`;
  const phases = [
    ["initial", "", /Grouped Bash/u],
    ["warmup", `/bash-scene ${env.PI_BASH_LAB_SCENE === "success" ? "long" : "success"}`, /Scene (?:success|long)/u],
    ["mixed", "/bash-scene mixed", /pnpm test/u],
  ];
  const script = join(run, "smoke.exp");
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
stty rows 44 columns 120 < $spawn_out(slave,name)
${phases.map(([name, command]) => `${command ? `send -- "\\025${command}\\r"` : ""}\ncapture ${name}`).join("\n")}
send -- "\\017"
capture mixedExpanded
send -- "\\017"
capture mixedCollapsed
send -- "\\025/bash-scene success\\r"
capture success
send -- "\\017"
capture successExpanded
send -- "\\025/bash-replay\\r"
capture replay
send -- "\\025/bash-pause\\r"
capture paused
send -- "\\025/bash-settle\\r"
capture settled
send -- "\\017"
capture successCollapsed
send -- "\\025/bash-scene long\\r"
capture long
send -- "\\017"
capture longExpanded
send -- "\\017"
capture longCollapsed
send -- "\\025/bash-scene edge\\r"
capture edge
stty rows 28 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow
send -- "\\017"
capture expanded
send -- "\\017"
capture collapsed
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
      const timer = setTimeout(() => { cleanup(); reject(new Error(`PTY smoke timed out: ${diagnostics}`)); }, 75000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { exited = true; clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const read = name => stripVTControlCharacters(readFileSync(join(run, `${name}.ansi`), "utf8"));
    for (const [name, , pattern] of phases) assert.match(read(name), pattern, `Missing ${name} marker`);
    assert.match(read("initial"), /Read README\.md/u);
    assert.match(read("initial"), /Edited fixture\.ts/u);
    assert.doesNotMatch(read("mixed"), /AssertionError|Build completed/u);
    assert.match(read("mixedExpanded"), /Build completed/u);
    assert.match(read("mixedCollapsed"), /ctrl\+o expand/u);
    assert.match(read("mixedCollapsed"), /git status --short/u);
    assert.match(read("success"), /3 succeeded/u);
    assert.match(read("successExpanded"), /Typecheck completed/u);
    assert.match(read("replay"), /running|playing/u);
    assert.match(read("paused"), /paused/u);
    assert.match(read("settled"), /Typecheck completed/u);
    assert.match(read("successCollapsed"), /3 succeeded/u);
    assert.match(read("successCollapsed"), /pnpm run typecheck/u);
    assert.doesNotMatch(read("successCollapsed"), /Typecheck completed/u);
    assert.match(read("longExpanded"), /Process exited with code 1/u);
    assert.match(read("longCollapsed"), /ctrl\+o expand/u);
    assert.match(read("edge"), /Truncated capture/u);
    const all = [...phases.map(([name]) => name), "mixedExpanded", "mixedCollapsed", "success", "successExpanded", "replay", "paused", "settled", "successCollapsed", "long", "longExpanded", "longCollapsed", "edge", "narrow", "expanded", "collapsed", "reload"].map(read).join("\n");
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available|This project is not trusted|\/bash-logs|Alt\+L logs/u);
    console.log("Real Pi CLI PTY smoke passed: aligned labels, persistent commands, folded results, full captures, playback, resize, reload, clean exit.");
  } finally {
    cleanup();
    process.off("exit", cleanup);
  }
}
