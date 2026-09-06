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
    ["initial", "", /Called context7/u],
    ["variant2", "/summary-style 2", /\[2\]/u],
    ["variant3", "/summary-style 3", /\[3\]/u],
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
capture expanded
send -- "\\017"
capture collapsed
send -- "\\025/summary-style 4\\r"
capture variant4
send -- "\\017"
capture variant4Expanded
send -- "\\017"
capture variant4Collapsed
send -- "\\025/write-replay\\r"
capture writeRunning
after 2500
capture writeCompleted
stty rows 28 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow
send -- "\\025/summary-style 1\\r"
capture variant1
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
    assert.match(read("initial"), /Write src\/config.ts/u);
    assert.doesNotMatch(read("variant2"), /Completed|Written/u);
    assert.doesNotMatch(read("variant3"), /Completed|Written/u);
    assert.match(read("expanded"), /Available Libraries:/u);
    assert.match(read("expanded"), /"source": "fixture"/u);
    assert.match(read("collapsed"), /ctrl\+o expand/u);
    assert.doesNotMatch(read("collapsed"), /Available Libraries:/u);
    assert.match(read("variant4"), /\[4\]/u);
    assert.match(read("variant4"), /Available Libraries:/u);
    assert.match(read("variant4"), /Write src\/config.ts \(20 lines\)/u);
    assert.doesNotMatch(read("variant4"), /Completed|Written|TypeScript examples/u);
    assert.match(read("variant4Expanded"), /TypeScript examples/u);
    assert.match(read("variant4Collapsed"), /Available Libraries:/u);
    assert.doesNotMatch(read("variant4Collapsed"), /TypeScript examples/u);
    assert.match(read("writeRunning"), /• Write src\/config.ts/u);
    assert.doesNotMatch(read("writeRunning"), /Write src\/config.ts \(20 lines\)|Writing|Written/u);
    assert.match(read("writeCompleted"), /Write src\/config.ts \(20 lines\)/u);
    assert.match(read("variant1"), /Completed/u);
    assert(read("reload").includes(`[${env.PI_SUMMARY_LAB_VARIANT}]`));
    const all = [...phases.map(([name]) => name), "expanded", "collapsed", "variant4", "variant4Expanded", "variant4Collapsed", "writeRunning", "writeCompleted", "narrow", "variant1", "reload"].map(read).join("\n");
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available|This project is not trusted/u);
    console.log("Real Pi CLI PTY smoke passed: four variants, Write replay, expansion, collapse, resize, reload, clean exit.");
  } finally {
    cleanup();
    process.off("exit", cleanup);
  }
}
