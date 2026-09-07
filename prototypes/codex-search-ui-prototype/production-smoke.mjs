// VERIFICATION: Exercise production search through the real Pi CLI with HTTP fixtures.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { createRequire } from "node:module";
const { Terminal } = createRequire(new URL("../codex-ui-performance/package.json", import.meta.url))("@xterm/headless");

export async function smokePty({ run, env, cliArgs }) {
  const quote = value => `"${value.replace(/[\\"$\[\]]/gu, character => `\\${character}`)}"`;
  const script = join(run, "smoke.exp");
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
stty rows 40 columns 130 < $spawn_out(slave,name)
capture initial 2
capture progress 1
capture complete 3
send -- "\\017"
capture expanded 1
send -- "\\017"
capture collapsed 1
send -- "\\025/production-search partial\\r"
capture partial 6
send -- "\\025/production-search error\\r"
capture failed 6
send -- "\\025/production-search success\\r"
capture running 1
send -- "\\033"
capture cancelled 2
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
      const timer = setTimeout(() => { cleanup(); reject(new Error(`PTY timeout: ${diagnostics}`)); }, 60000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { exited = true; clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const read = name => stripVTControlCharacters(readFileSync(join(run, `${name}.ansi`), "utf8"));
    const raw = name => readFileSync(join(run, `${name}.ansi`), "utf8");
    assert(read("initial").includes("Searching 0/2"), read("initial"));
    assert((read("initial") + read("progress") + read("complete")).includes("Searching 1/2"));
    assert(read("complete").includes("Did 2 searches"), read("complete"));
    assert(raw("complete").includes("\x1b[38;2;120;217;154m"));
    assert(read("expanded").includes("Fixture search result"));
    assert(read("partial").includes("Did 1/2 searches"), read("partial"));
    assert(read("failed").includes("Web search failed"), read("failed"));
    assert(read("cancelled").includes("Web search cancelled"), read("cancelled"));
    const phases = ["initial", "progress", "complete", "expanded", "collapsed", "partial", "failed", "running", "cancelled"];
    const emulator = new Terminal({ cols: 130, rows: 40, scrollback: 1000, allowProposedApi: true, logLevel: "off" });
    try {
      for (const phase of phases) {
        await new Promise(resolve => emulator.write(Buffer.from(raw(phase)), resolve));
        const buffer = emulator.buffer.active;
        const rows = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? "");
        if (phase === "complete") {
          const index = rows.findLastIndex(line => line.includes("Did 2 searches"));
          assert(index >= 0, rows.join("\n"));
          assert(rows[index].includes("3 sources"), rows[index]);
          assert.equal(buffer.getLine(index).getCell(rows[index].indexOf("✓")).getFgColor(), 0x78D99A);
          for (let x = 0; x < 130; x++) assert.equal(buffer.getLine(index).getCell(x).getBgColorMode(), 0);
        }
      }
    } finally { emulator.dispose(); }
    assert.doesNotMatch(phases.map(read).join("\n"), /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available/u);
    console.log("Production Pi CLI PTY smoke passed: real execution, progress, success, expansion, partial failure, failure, cancellation, and background-free green completion.");
  } finally {
    cleanup();
    process.off("exit", cleanup);
  }
}
