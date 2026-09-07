// PROTOTYPE: Exercise the real Pi CLI, keyboard input, repaint, and clean shutdown.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export async function smokePty({ run, env, cliArgs }) {
  execFileSync("/usr/bin/expect", ["-v"]);
  const productionReplies = env.PI_SPACING_LAB_PRODUCTION_REPLIES === "1";
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
  puts stderr "Captured $name"
}
spawn -noecho ${[process.execPath, ...cliArgs].map(quote).join(" ")}
stty rows 100 columns 140 < $spawn_out(slave,name)
capture initial
send -- "\\025/edit-style 2\\r"
capture underline
send -- "\\0333"
capture rail
send -- "\\017"
capture expanded
send -- "\\017"
capture collapsed
${productionReplies ? "" : `send -- "\\025/reply-style current\\r"
capture replyCurrent
send -- "\\033r"
capture replyCycled
send -- "\\025/reply-style quote\\r"
capture replyQuote
send -- "\\025/reply-style list\\r"
capture replyList`}
stty rows 32 columns 60 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture narrow
send -- "\\025/edit-style 1\\r"
capture tinted
stty rows 100 columns 140 < $spawn_out(slave,name)
exec kill -WINCH [exp_pid]
capture restored
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
      const timer = setTimeout(() => { cleanup(); reject(new Error(`PTY smoke timed out: ${diagnostics}`)); }, 50000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { exited = true; clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 0, diagnostics);
    const raw = name => readFileSync(join(run, `${name}.ansi`), "utf8");
    const text = name => stripVTControlCharacters(raw(name));
    assert.match(text("initial"), /Edited prototypes\/codex-reasoning-ui-prototype\/pty-smoke\.mjs/u);
    assert.match(text("initial"), /Read README\.md/u);
    assert.match(text("initial"), /4 lines hidden/u);
    const initialReply = env.PI_SPACING_LAB_REPLY_STYLE;
    const marker = { current: "", indented: "• ", list: "- ", quote: "│ " };
    assert(text("initial").includes(marker[initialReply] + "This reply preview"));
    assert.match(text("initial"), /Reply layout fixture complete/u);
    if (!productionReplies) {
      assert(text("initial").includes(initialReply === "indented" ? "Legacy lab host" : "Public API"));
      assert.match(text("replyCurrent"), /Reply: current/u);
      assert.doesNotMatch(text("replyCurrent"), /• This reply preview/u);
      const cycled = initialReply === "indented" ? "indented" : "list";
      assert(text("replyCycled").includes(`Reply: ${cycled}`));
      assert(text("replyCycled").includes(marker[cycled] + "This reply preview"));
      assert.match(text("replyList"), /Reply: list/u);
      assert.match(text("replyCycled") + text("replyList"), /- This reply preview/u);
      assert.match(text("replyQuote"), /Reply: quote/u);
      assert.match(text("replyQuote"), /│ This reply preview/u);
    } else {
      assert.doesNotMatch(text("initial"), /Reply:|reply-style|- - This reply preview/u);
    }
    assert.match(text("initial") + text("underline"), /\[2\] Underlined header/u);
    assert((raw("initial") + raw("underline")).includes("\x1b[4m"));
    assert.match(text("rail"), /\[3\] Diff rail/u);
    assert.match(text("rail"), /│/u);
    assert.match(text("expanded"), /Fixture checks passed/u);
    assert.match(text("collapsed"), /4 lines hidden/u);
    assert.match(text("tinted"), /\[1\] Tinted header/u);
    assert(text("reload").includes(`[${env.PI_SPACING_LAB_VARIANT}]`));
    if (!productionReplies) assert(text("reload").includes(`Reply: ${initialReply}`));
    assert(text("reload").includes(marker[initialReply] + "This reply preview"));
    assert.doesNotMatch(text("reload"), /- - This reply preview/u);
    const comparisonPhases = productionReplies ? [] : ["replyCurrent", "replyCycled", "replyList", "replyQuote"];
    const all = ["initial", "underline", "rail", "expanded", "collapsed", ...comparisonPhases, "narrow", "tinted", "restored", "reload"].map(text).join("\n");
    assert.doesNotMatch(all, /Failed to load extension|TypeError:|RangeError:|ReferenceError:|Error loading theme|No models available|This project is not trusted/u);
    console.log(`Real Pi CLI PTY smoke passed: ${productionReplies ? "production replies" : "reply comparisons"}, three edit styles, shortcuts, expansion, collapse, resize, reload, clean exit.`);
  } finally {
    cleanup();
    process.off("exit", cleanup);
  }
}
