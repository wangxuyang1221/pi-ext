// Exercise the real CLI, extension loading, repaint, expansion and terminal resizing.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
export async function smokePty({ run, env, cliArgs }) {
  const quote = value => `"${value.replace(/[\\"$\[\]]/gu, character => `\\${character}`)}"`;
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
}
spawn -noecho ${[process.execPath, ...cliArgs].map(quote).join(" ")}
stty rows 48 columns 120 < $spawn_out(slave,name)
capture initial
${[0, 1, 2, 3, 4, 5, 6].map(i => `send -- "\\025/read-style ${i}\\r"\ncapture variant${i}`).join("\n")}
send -- "\\025/read-style 6\\r"
capture group
${["cyan", "soft", "blue"].map(color => `send -- "\\025/read-color ${color}\\r"\ncapture color${color}`).join("\n")}
send -- "\\017"
capture expanded
send -- "\\017"
capture collapsed
send -- "\\025/read-replay\\r"
capture pending
after 1500
capture settled
stty rows 28 columns 48 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow
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
  const child = spawn("/usr/bin/expect", [script], { cwd: join(run, "workspace"), env: { ...env, PI_LAB_SMOKE_RUN: run }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let exited = false;
  let diagnostics = "";
  const cleanup = () => { if (!exited && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  process.on("exit", cleanup);
  child.stdout.on("data", data => { diagnostics += data; });
  child.stderr.on("data", data => { diagnostics += data; });
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`PTY smoke timed out: ${diagnostics}`)); }, 60000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { exited = true; clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const read = name => stripVTControlCharacters(readFileSync(join(run, `${name}.ansi`), "utf8"));
    for (const i of [0, 1, 2, 3, 4, 5, 6]) assert(read(`variant${i}`).includes(`[${i}]`), `Missing variant ${i}`);
    assert.match(read("initial"), /repository-language-policy.md/u);
    assert.match(read("initial"), /Edited fixture.ts/u);
    assert.match(read("variant2"), /╭/u);
    assert.match(read("variant3"), /Repository language policy/u);
    assert.match(read("variant4"), /Read 3 files/u);
    assert.match(read("variant5"), /● Read/u);
    assert.match(read("variant6"), /Read 3 files/u);
    assert.match(read("variant6"), /# Repository language policy/u);
    assert.doesNotMatch(read("variant6"), /Fixture policy rule 28/u);
    for (const color of ["cyan", "soft", "blue"]) {
      assert(read(`color${color}`).includes(`color: ${color}`));
      // Color-only repaints leave the unchanged group header out of the ANSI delta.
      assert.match(read(`color${color}`), /repository-language-policy.md/u);
    }
    assert(readFileSync(join(run, "colorsoft.ansi"), "utf8").includes("\u001b[38;2;138;191;196m"));
    assert(readFileSync(join(run, "colorblue.ansi"), "utf8").includes("\u001b[38;2;157;181;206m"));
    assert.match(read("expanded"), /Fixture policy rule 28/u);
    assert.doesNotMatch(read("collapsed"), /Fixture policy rule 28/u);
    assert.match(read("pending"), /Reading/u);
    assert.match(read("settled"), /31 lines/u);
    assert(read("reload").includes(`[${env.PI_READ_LAB_VARIANT}]`));
    const all = ["initial", ...[0, 1, 2, 3, 4, 5, 6].map(i => `variant${i}`), "colorcyan", "colorsoft", "colorblue", "expanded", "collapsed", "narrow", "reload"].map(read).join("\n");
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available|This project is not trusted/u);
    console.log("Real Pi CLI PTY smoke passed: seven layouts, three filename colors, grouped preview expansion, replay, resize, reload and clean exit.");
  } finally {
    cleanup();
    process.off("exit", cleanup);
  }
}
