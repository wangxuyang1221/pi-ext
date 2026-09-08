// PROTOTYPE: Verify both summary previews in an actual isolated Pi CLI and PTY.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
const { Terminal } = createRequire(new URL("../codex-ui-performance/package.json", import.meta.url))("@xterm/headless");

export async function smokePty({ run, env, cliArgs, prompt, manifest, variant = "fixed", upgrade = false, sourceRoot }) {
  const inline = variant === "inline" || variant === "production";
  const quote = value => `"${value.replace(/[\\"$\[\]]/gu, character => `\\${character}`)}"`;
  const script = join(run, "fixed-smoke.exp");
  const tracePath = join(run, "events.jsonl");
  writeFileSync(script, `set timeout 15
log_user 0
proc capture {name seconds} {
  log_file -a -noappend "$::env(PI_REASONING_SMOKE_RUN)/$name.ansi"
  expect {
    -timeout $seconds
    -re {.+} { exp_continue -continue_timer }
    timeout {}
    eof { error "CLI exited early during $name" }
  }
  log_file
}
proc quit {} {
  send -- "\\025\\004"
  expect {
    eof {}
    timeout { error "CLI did not exit" }
  }
  set result [wait]
  if {[lindex $result 3] != 0} { error "CLI exited unsuccessfully" }
}
spawn -noecho ${[process.execPath, ...cliArgs, prompt].map(quote).join(" ")}
stty rows 40 columns 120 < $spawn_out(slave,name)
capture completed 6
send -- "\\024"
capture thinkingHidden 1
send -- "\\024"
send -- "\\025/demo long\\r"
stty rows 28 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow 5
send -- "\\017"
capture expanded 1
send -- "\\017"
capture collapsed 1
send -- "\\025/demo\\r"
log_file -a -noappend "$::env(PI_REASONING_SMOKE_RUN)/aborted.ansi"
expect {
  -re {Reading the local fixture} {}
  timeout { error "Replay thinking did not appear" }
}
send -- "\\033"
expect {
  -timeout 2
  -re {.+} { exp_continue -continue_timer }
  timeout {}
  eof { error "CLI exited during cancellation" }
}
log_file
${upgrade ? `exec ${[process.execPath, "-e", 'const fs = require("fs"); fs.rmSync(process.argv[2], { recursive: true }); fs.cpSync(process.argv[1], process.argv[2], { recursive: true })', join(run, "upgrade-after"), sourceRoot].map(quote).join(" ")}` : ""}
send -- "\\025/reload\\r"
capture reload 2
quit
set session [exec ${[process.execPath, "-e", 'const e = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\\n").map(JSON.parse); process.stdout.write(e.find(x => x.type === "ready").sessionFile)', tracePath].map(quote).join(" ")}]
spawn -noecho ${[process.execPath, ...cliArgs, "--session"].map(quote).join(" ")} $session
stty rows 40 columns 120 < $spawn_out(slave,name)
capture restored 3
quit
`);
  const child = spawn("/usr/bin/expect", [script], {
    cwd: join(run, "workspace"), env: { ...env, PI_REASONING_SMOKE_RUN: run,
      PI_REASONING_LAB_TRACE: tracePath, PI_REASONING_LAB_FAST: "1" },
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stdout.on("data", data => { diagnostics += data; });
  child.stderr.on("data", data => { diagnostics += data; });
  const cleanup = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, cleanup);
  process.on("exit", cleanup);
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`${variant} PTY timeout: ${diagnostics}`)); }, 45000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const captures = Object.fromEntries(["completed", "thinkingHidden", "narrow", "expanded", "collapsed", "aborted", "reload", "restored"]
      .map(name => [name, readFileSync(join(run, `${name}.ansi`), "utf8")]));
    // Keep evidence inside the repository, outside the launcher's disposable run directory.
    writeFileSync(new URL(`.tmp/latest-${upgrade ? "upgrade" : "smoke"}-${manifest.version}-${variant}.json`, import.meta.url), JSON.stringify({ manifest, captures }, null, 2));
    const all = stripVTControlCharacters(Object.values(captures).join("\n"));
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|No models available|Tool execution failed/u);
    if (inline) assert.match(stripVTControlCharacters(captures.thinkingHidden), /Thinking[.]{3}/u,
      "Inline summaries must preserve the native hidden-thinking placeholder");
    else assert.doesNotMatch(stripVTControlCharacters(captures.thinkingHidden), /Thinking[.]{3}/u,
      "Native thinking toggle must not reintroduce history placeholders");
    assert.match(all, /Computing the ratio/u);
    assert.match(all, /Preparing validation report/u);
    assert.doesNotMatch(upgrade ? stripVTControlCharacters(captures.restored) : all,
      /先读取隔离工作目录|前面的内容也应保留|• Thinking(?:\s|$)|Running write/u);
    assert.match(stripVTControlCharacters(captures.aborted), /中断|aborted/iu);
    for (const name of upgrade ? ["restored"] : ["completed", "restored"]) {
      const terminal = new Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: "off" });
      try {
        await new Promise(resolve => terminal.write(Buffer.from(captures[name]), resolve));
        const buffer = terminal.buffer.active;
        const rows = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? "");
        const screen = rows.join("\n");
        assert.match(screen, /演示完成/u);
        assert.match(screen, /Write report[.]md/u);
        const editor = rows.findLastIndex(row => row.includes("Ask Pi"));
        assert.ok(editor >= 3, "The real editor must remain visible");
        if (inline) {
          assert.match(screen, /• Reading the local fixture/u);
          assert.match(screen, /• Preparing validation report/u);
          assert.doesNotMatch(screen, /我现在补齐报告|先读取隔离工作目录/u,
            "Superseded titles and reasoning bodies must not reappear in final history");
          if (name === "completed") {
            assert.equal(rows.filter(row => row.includes("• Computing the ratio")).length, 1);
            assert.equal(rows.filter(row => row.includes("• Preparing validation report")).length, 2);
            const summaryRow = rows.findIndex(row => row.includes("• Preparing validation report"));
            const writeRow = rows.findIndex(row => row.includes("Write report.md"));
            assert.ok(summaryRow >= 0 && summaryRow < writeRow, "Summary belongs above its tool, not above the editor");
          }
        } else {
          assert.doesNotMatch(screen, /Reading the local fixture|Computing the ratio|Preparing validation report|先读取隔离/u,
            "Settled and restored history must contain no thinking titles or bodies");
          assert.equal(rows[editor - 2], "");
          assert.equal(rows[editor - 3], "", "The fixed status row must be empty after settlement");
        }
      } finally { terminal.dispose(); }
    }
    const events = readFileSync(tracePath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.filter(event => event.type === "tool").map(event => event.name),
      ["read", "bash", "write", "edit", "read", "bash", "write", "edit"]);
    assert.equal(events.filter(event => event.type === "settled").length, 3);
    const session = readFileSync(events.find(event => event.type === "ready").sessionFile, "utf8");
    assert.match(session, /\*\*Computing the ratio\*\*/u, "Thinking must remain in the persisted session");
    assert.match(readFileSync(join(run, "workspace/report.md"), "utf8"), /此文件不代表真实性能测试结论/u);
    console.log(`${variant} PTY smoke passed (Pi ${manifest.version}): real tools, repeated titles, progressive arguments, resize, replay, cancellation, reload and session restore.`);
  } finally {
    cleanup(); process.off("exit", cleanup);
    for (const signal of signals) process.off(signal, cleanup);
  }
}
