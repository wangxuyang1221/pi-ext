// PROTOTYPE: Exercise the actual Pi CLI, not a reconstructed terminal screen.
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
capture progress 3
capture complete 3
send -- "\\025/search-check gray\\r"
capture gray 1
send -- "\\025/search-check green\\r"
capture green 1
send -- "\\025/search-style accent\\r"
capture accent 1
send -- "\\025/search-style minimal\\r"
capture minimal 1
send -- "\\017"
capture expanded 1
send -- "\\017"
capture collapsed 1
send -- "\\025/search-replay\\r"
capture replay 1
send -- "\\025/search-pause\\r"
capture paused 1
send -- "\\025/search-pause\\r"
capture resumed 1
stty rows 40 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow 1
send -- "\\025/search-scene error\\r"
capture errorRunning 1
send -- "\\025/search-finish\\r"
capture error 1
send -- "\\025/search-scene success\\r"
capture exitingDuringPlayback 1
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
    const initial = read("initial");
    assert(initial.includes("Minimal"), initial);
    assert(initial.includes("Searching 0/2"), initial);
    assert(read("progress").includes("Searching 1/2"), read("progress"));
    assert((read("progress") + read("complete")).includes("finalizing"));
    assert(read("complete").includes("Did 2 searches in 6s"), read("complete"));
    const raw = name => readFileSync(join(run, `${name}.ansi`), "utf8");
    assert(raw("complete").includes("\x1b[38;2;120;217;154m"));
    assert(read("gray").includes("gray check"));
    assert(!raw("gray").includes("\x1b[38;2;120;217;154m"));
    assert(raw("green").includes("\x1b[38;2;120;217;154m"));
    assert(raw("accent").includes("\x1b[38;2;166;218;220mWeb Search\x1b[39m"));
    assert(raw("accent").includes("\x1b[38;2;168;204;236m3 sources\x1b[39m"));
    assert(!raw("minimal").includes("\x1b[38;2;168;204;236m"));
    assert(read("expanded").includes("Sources:"));
    // Collapsing may only erase detail rows; inspect the accumulated terminal state below.
    assert(read("replay").includes("Searching 0/2"));
    assert(read("paused").includes("paused"));
    assert(read("resumed").includes("Searching"));
    assert(read("error").includes("Web search failed"));
    const phases = ["initial", "progress", "complete", "gray", "green", "accent", "minimal", "expanded", "collapsed", "replay", "paused", "resumed", "narrow", "errorRunning", "error", "exitingDuringPlayback"];
    const emulator = new Terminal({ cols: 130, rows: 40, scrollback: 1000, allowProposedApi: true, logLevel: "off" });
    try {
      for (const phase of phases) {
        if (phase === "narrow") emulator.resize(60, 40);
        await new Promise(resolve => emulator.write(Buffer.from(raw(phase)), resolve));
        const buffer = emulator.buffer.active;
        const rows = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? "");
        const screen = rows.join("\n");
        if (["complete", "gray", "green", "accent", "minimal", "collapsed"].includes(phase)) {
          assert(screen.includes("3 sources"), `${phase}: ${screen}`);
          assert(!screen.includes("Searching"), `${phase}: stale progress text`);
          assert(!screen.includes("Sources:"), `${phase}: stale expanded content`);
          const index = rows.findLastIndex(line => line.includes("Did 2 searches"));
          assert(index >= 0);
          const col = rows[index].indexOf("✓");
          const cell = buffer.getLine(index).getCell(col);
          assert.equal(cell.getFgColor(), phase === "gray" ? 0xA4ADB6 : 0x78D99A);
          for (let x = 0; x < 130; x++) assert.equal(buffer.getLine(index).getCell(x).getBgColorMode(), 0);
        }
        if (phase === "expanded") assert(screen.includes("Sources:"));
        if (phase === "replay") assert(!screen.includes("Did 2 searches"), "Replay must clear completed output");
      }
    } finally { emulator.dispose(); }
    const all = phases.map(read).join("\n");
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available|This project is not trusted/u);
    console.log("Real Pi CLI PTY smoke passed: animation, progress, finalization, green/gray check, accent/minimal switch, replay, pause/resume, expansion, resize, failure, exit during playback.");
  } finally {
    cleanup();
    process.off("exit", cleanup);
  }
}
