// Real CLI smoke for OSC title writes, isolated from the Bash layout comparison.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export async function smokePty({ run, env, cliArgs }) {
  const quote = value => `"${value.replace(/[\\"$\[\]]/gu, character => `\\${character}`)}"`;
  const script = join(run, "title-smoke.exp");
  writeFileSync(script, `set timeout 15
log_user 0
proc capture {name seconds} {
  log_file -a -noappend "$::env(PI_LAB_SMOKE_RUN)/$name.ansi"
  expect {
    -timeout $seconds
    -re {.+} { exp_continue -continue_timer }
    timeout {}
    eof { error "CLI exited early during $name" }
  }
  log_file
}
spawn -noecho ${[process.execPath, ...cliArgs].map(quote).join(" ")}
stty rows 44 columns 120 < $spawn_out(slave,name)
capture initial 4
capture smooth 2
send -- "\\025/title-motion legacy\\r"
capture legacy 2
send -- "\\025/title-motion smooth\\r"
capture resumed 1
send -- "\\025/title-stall\\r"
capture stalled 1
send -- "\\025/title-stats\\r"
capture stats 1
send -- "\\025/title-motion off\\r"
capture stopped 1
capture idle 1
send -- "\\025\\004"
expect {
  eof {}
  timeout { exec kill -TERM [exp_pid]; expect eof; error "CLI did not exit" }
}
set result [wait]
exit [lindex $result 3]
`);
  const child = spawn("/usr/bin/expect", [script], {
    cwd: join(run, "workspace"), env: { ...env, PI_LAB_SMOKE_RUN: run }, detached: true,
    stdio: ["ignore", "pipe", "pipe"],
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
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Title smoke timed out: ${diagnostics}`)); }, 30000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { exited = true; clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const read = name => readFileSync(join(run, `${name}.ansi`), "utf8");
    const titles = name => [...read(name).matchAll(/\x1b\]0;([^\x07]*)\x07/gu)].map(match => match[1]);
    assert(new Set(titles("smooth")).size >= 5, "Smooth animation must advance through multiple frames");
    assert(titles("smooth").every(title => title.endsWith("π · pi-ext")));
    assert.equal(read("smooth").replace(/\x1b\]0;[^\x07]*\x07/gu, "").trim(), "", "Idle title ticks must write only OSC titles, not redraw the TUI");
    assert(titles("legacy").some(title => title.includes("Thinking..")));
    assert(titles("resumed").some(title => title.endsWith("π · pi-ext")));
    assert(titles("stalled").length > 0);
    assert.match(stripVTControlCharacters(read("stats")), /P95/u);
    assert.equal(titles("stopped").at(-1), "π · pi-ext");
    assert.equal(titles("idle").length, 0, "Stopped animation must not keep writing titles");
    const all = ["initial", "smooth", "legacy", "resumed", "stalled", "stats", "stopped", "idle"].map(read).join("\n");
    assert.doesNotMatch(stripVTControlCharacters(all), /Failed to load extension|TypeError:|RangeError:|ReferenceError:/u);
    console.log(`Title CLI smoke passed: ${titles("smooth").length} title writes in the 2s smooth sample, no visible TUI redraw, legacy comparison, injected stall, stop, clean exit.`);
  } finally { cleanup(); process.off("exit", cleanup); }
}
