// PROTOTYPE: Drive the actual CLI, provider, tools, keyboard cancellation and session restore.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { createRequire } from "node:module";
const { Terminal } = createRequire(new URL("../codex-ui-performance/package.json", import.meta.url))("@xterm/headless");

export async function smokePty({ run, env, cliArgs, variant, prompt, manifest, upgrade = false, sourceRoot }) {
  const quote = value => `"${value.replace(/[\\"$\[\]]/gu, character => `\\${character}`)}"`;
  const script = join(run, "smoke.exp");
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
  puts stderr "Captured $name"
}
proc awaitTitle {name} {
  log_file -a -noappend "$::env(PI_REASONING_SMOKE_RUN)/$name.ansi"
  expect {
    -re {Reading the local fixture} {}
    timeout { error "Thinking title did not appear during $name" }
    eof { error "CLI exited during $name" }
  }
  log_file
}
spawn -noecho ${[process.execPath, ...cliArgs, prompt].map(quote).join(" ")}
stty rows 40 columns 120 < $spawn_out(slave,name)
log_file -a -noappend "$::env(PI_REASONING_SMOKE_RUN)/initial.ansi"
expect {
  -re {Reading the local fixture} {}
  timeout { error "Initial thinking title did not appear" }
  eof { error "CLI exited before the initial thinking title" }
}
log_file
capture live 1
capture quiet 1
capture completed 16
send -- "\\025/demo long\\r"
capture longLive 9
stty rows 28 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow 9
send -- "\\017"
capture expanded 1
send -- "\\017"
capture collapsed 1
send -- "\\025/demo\\r"
capture replay 1
send -- "\\033"
capture aborted 2
${upgrade ? `exec ${[process.execPath, "-e", 'require("fs").cpSync(process.argv[1], process.argv[2], { recursive: true })', join(run, "upgrade-after"), sourceRoot].map(quote).join(" ")}` : ""}
send -- "\\025/reload\\r"
capture reload 3
${upgrade ? `send -- "\\025/demo\\r"
awaitTitle upgradeInitial
capture upgradeLive 1
capture upgradeQuiet 1
send -- "\\033"
capture upgradeAborted 2` : ""}
send -- "\\025\\004"
expect {
  eof {}
  timeout { exec kill -TERM [exp_pid]; expect eof; error "CLI did not exit" }
}
set result [wait]
if {[lindex $result 3] != 0} { error "First CLI exited unsuccessfully" }
set session [exec ${[process.execPath, "-e", 'const events = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\\n").map(JSON.parse); process.stdout.write(events.find(e => e.type === "ready").sessionFile)', join(run, "events.jsonl")].map(quote).join(" ")}]
spawn -noecho ${[process.execPath, ...cliArgs, "--session"].map(quote).join(" ")} $session
stty rows 40 columns 120 < $spawn_out(slave,name)
capture restored 4
${upgrade ? `send -- "\\025/demo\\r"
awaitTitle restartedInitial
capture restartedLive 1
capture restartedQuiet 1
send -- "\\033"
capture restartedAborted 2` : ""}
send -- "\\025\\004"
expect {
  eof {}
  timeout { exec kill -TERM [exp_pid]; expect eof; error "Restored CLI did not exit" }
}
set result [wait]
exit [lindex $result 3]
`);
  const child = spawn("/usr/bin/expect", [script], {
    cwd: join(run, "workspace"), env: { ...env, PI_REASONING_SMOKE_RUN: run, PI_REASONING_LAB_TRACE: join(run, "events.jsonl") },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let exited = false;
  let diagnostics = "";
  const cleanup = () => {
    if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, cleanup);
  process.on("exit", cleanup);
  child.stdout.on("data", data => { diagnostics += data; });
  child.stderr.on("data", data => { diagnostics += data; });
  try {
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`PTY smoke timed out: ${diagnostics}`)); }, 90000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { exited = true; clearTimeout(timeout); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const names = ["initial", "live", "quiet", "completed", "longLive", "narrow", "expanded", "collapsed", "replay", "aborted", "reload", "restored",
      ...(upgrade ? ["upgradeInitial", "upgradeLive", "upgradeQuiet", "upgradeAborted", "restartedInitial", "restartedLive", "restartedQuiet", "restartedAborted"] : [])];
    const raw = name => readFileSync(join(run, `${name}.ansi`), "utf8");
    const text = name => stripVTControlCharacters(raw(name));
    const all = names.map(text).join("\n");
    writeFileSync(new URL(`.tmp/latest-${upgrade ? "upgrade" : "smoke"}-${manifest.version}-${variant}.json`, import.meta.url), JSON.stringify({
      variant, manifest, upgrade, hotReloadHasQuietOutput: upgrade ? raw("upgradeQuiet").length > 0 : undefined,
      captures: Object.fromEntries(names.map(name => [name, raw(name)])),
    }, null, 2));
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available|This project is not trusted|Tool execution failed/u);
    assert.match(text("initial") + text("live"), /\/demo/u);
    assert.match(text("initial") + text("live"), /Reading the local fixture/u);
    assert.match(text("completed"), /演示完成/u);
    assert.match(text("narrow"), /最后一段/u);
    assert.match(text("aborted"), /中断|aborted/iu);
    assert.match(text("reload"), /reload|Reload|重新|原型/u);
    assert.match(text("restored"), /最后一段/u);
    if (variant === "production" && !upgrade) {
      assert.match(text("completed"), /- 演示完成/u, "Production replies must use the outer list layout");
      assert.doesNotMatch(text("completed"), /- - 演示完成/u, "Streaming must not stack list wrappers");
      assert.doesNotMatch(all, /Preparing response|Running (?:read|bash|write|edit)|• Thinking(?:\s|$)/u,
        "Production must not emit generic reasoning statuses");
    }
    if (upgrade) {
      assert.equal(raw("restartedQuiet").length, 0, "Restarted production must not animate");
      assert.doesNotMatch(text("restartedLive"), /先读取隔离工作目录/u);
      console.log(`Hot reload quiet bytes: ${raw("upgradeQuiet").length}; restart quiet bytes: ${raw("restartedQuiet").length}.`);
    }
    if (variant !== "current" && !upgrade) {
      assert.equal(raw("quiet").length, 0, `Unexpected quiet output: ${JSON.stringify(raw("quiet"))}`);
      assert.doesNotMatch(text("initial") + text("live"), /先读取隔离工作目录/u);
      const emulator = new Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: "off" });
      try {
        await new Promise(resolve => emulator.write(Buffer.from(raw("initial") + raw("live") + raw("quiet")), resolve));
        const buffer = emulator.buffer.active;
        const rows = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? "");
        const row = rows.findLastIndex(line => line.includes("Reading the local fixture"));
        assert.ok(row >= 0, "Static title must be visible in the parsed terminal");
        assert.equal(rows[row + 1], "", "Status must have one empty row before the editor");
        for (let column = 0; column < 120; column++) {
          assert.equal(buffer.getLine(row + 1).getCell(column).getBgColorMode(), 0, "Gap must have no editor background");
        }
        const markerColumn = 0;
        const textColumn = markerColumn + 2;
        assert.equal(rows[row].indexOf("•"), markerColumn, "Status marker must use the variant's left edge");
        assert.equal(rows[row].indexOf("Reading"), textColumn);
        assert.equal(buffer.getLine(row).getCell(textColumn).isBold(), 0);
        assert.equal(buffer.getLine(row).getCell(textColumn).isItalic(), 0);
        await new Promise(resolve => emulator.write(Buffer.from(raw("completed")), resolve));
        assertAlignedHistory(emulator);
        await new Promise(resolve => emulator.write(Buffer.from(raw("longLive")), resolve));
        emulator.resize(60, 28);
        await new Promise(resolve => emulator.write(Buffer.from(raw("narrow")), resolve));
        assertAlignedHistory(emulator);
      } finally { emulator.dispose(); }
      const restored = new Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: "off" });
      try {
        await new Promise(resolve => restored.write(Buffer.from(raw("restored")), resolve));
        assertAlignedHistory(restored);
      } finally { restored.dispose(); }
    }
    assert.match(readFileSync(join(run, "workspace/report.md"), "utf8"), /此文件不代表真实性能测试结论/u);
    const events = readFileSync(join(run, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(events.filter(event => event.type === "tool").map(event => event.name),
      ["read", "bash", "write", "edit", "read", "bash", "write", "edit"]);
    assert.equal(events.filter(event => event.type === "settled").length, upgrade ? 5 : 3);
    if (variant === "proposed") assert.equal(events.filter(event => event.type === "status").at(-1).title, "");
    const sessionFiles = walk(join(run, "sessions")).filter(file => file.endsWith(".jsonl"));
    assert.ok(sessionFiles.length > 0, "Real Pi session must be persisted");
    const session = sessionFiles.map(file => readFileSync(file, "utf8")).join("\n");
    assert.ok(session.includes("**Computing the ratio**"), "Display transformation must preserve original thinking");
    if (variant === "production" && !upgrade) {
      const texts = session.split("\n").filter(Boolean).flatMap(line => {
        const entry = JSON.parse(line);
        return entry.message?.role === "assistant" ? entry.message.content.filter(part => part.type === "text").map(part => part.text) : [];
      });
      assert(texts.some(text => text.startsWith("演示完成。")), "Persisted replies must retain their original text");
      assert(!texts.some(text => text.startsWith("- 演示完成")), "Display markers must not enter the session");
    }
    console.log(`Real Pi PTY smoke passed (${variant}): streaming, quiet interval, real tools, multiline history, resize, expand, abort, reload, persisted-session restart${upgrade ? ", live code replacement" : ""} and clean exit.`);
  } finally {
    cleanup();
    process.off("exit", cleanup);
    for (const signal of signals) process.off(signal, cleanup);
  }
}
function assertAlignedHistory(terminal) {
  const buffer = terminal.buffer.active;
  const rows = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? "");
  const tool = rows.find(line => line.includes("✓ Read metrics.json"));
  const summary = rows.find(line => line.includes("• 先读取隔离工作目录"));
  assert.ok(tool, "Completed Read tool must be visible in the parsed terminal");
  assert.ok(summary, "Completed thinking must be visible in the parsed terminal");
  assert.equal(summary.indexOf("•"), tool.indexOf("✓"), "History marker must align with the tool icon");
  assert.equal(summary.indexOf("先读取"), tool.indexOf("Read"), "History text must align with the tool title");
  assert.equal(summary.indexOf("•"), 0, "Aligned profile must not retain native output padding");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
}
