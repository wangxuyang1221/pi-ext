#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stopProcessGroup } from "../../../../scripts/codex-compact-quality-process.mjs";

// Called by verify.mjs with its isolated environment and owned scratch directory.
const [root, evidence] = process.argv.slice(2);
assert.ok(root && evidence, "Use verify.mjs run permissions-modes");
const here = dirname(fileURLToPath(import.meta.url));
const children = [], results = [], actions = [];
const abort = new AbortController();
const interrupted = () => abort.abort(new Error("Verification interrupted"));
process.on("SIGTERM", interrupted);
process.on("SIGINT", interrupted);
const records = () => existsSync(join(root, "events.jsonl"))
  ? readFileSync(join(root, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
async function wait(predicate, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    abort.signal.throwIfAborted();
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}
function launch(label, extra) {
  const workspace = join(root, label);
  mkdirSync(workspace);
  const args = [resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), "--offline",
    "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes",
    "--session-dir", join(root, "sessions"), "--provider", "faux", "--model", "faux-1",
    "-e", resolve("extensions/permissions/dist/index.js"), "-e", join(here, "command-provider.ts"), ...extra];
  const child = spawn(process.execPath, args, { cwd: workspace, detached: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PI_VERIFY_ROOT: root, PI_PERMISSIONS_MODE: "default" } });
  const run = { label, child, workspace, command: [process.execPath, ...args], stdout: "", stderr: "", messages: [] };
  children.push(run);
  let pending = "";
  child.stdout.on("data", chunk => {
    run.stdout += chunk; pending += chunk;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try { run.messages.push(JSON.parse(line)); } catch { /* Preserve non-JSON output in the transcript. */ }
    }
  });
  child.stderr.on("data", chunk => { run.stderr += chunk; });
  run.closed = once(child, "close");
  return run;
}
let passed = false;
try {
  mkdirSync(join(root, "sessions"));
  writeFileSync(join(root, "agent/settings.json"), JSON.stringify({ quietStartup: true, defaultProjectTrust: "never",
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" }));
  for (const [label, prompts] of [["print-write", ["WRITE_PROOF"]], ["print-upgrade", ["/permissions full", "WRITE_PROOF"]]]) {
    const run = launch(label, ["--print", "--mode", "json", ...prompts]);
    run.child.stdin.end();
    await wait(() => run.child.exitCode !== null || run.child.signalCode !== null, label);
    await run.closed;
    assert.equal(run.child.exitCode, 0);
    assert.match(run.stdout, /Default permissions requires approval for write, but no UI is available/);
    assert.equal(existsSync(join(run.workspace, "proof.txt")), false);
    if (label === "print-upgrade") {
      const users = run.messages.filter(m => m.type === "message_start" && m.message?.role === "user");
      assert.ok(users.some(m => JSON.stringify(m.message.content).includes("WRITE_PROOF")));
      assert.equal(users.some(m => JSON.stringify(m.message.content).includes("/permissions full")), false,
        "Permission command must be consumed locally, not sent as a model prompt");
    }
    results.push({ label, passed: true, fileExists: false });
  }
  const run = launch("rpc", ["--mode", "rpc"]);
  const send = message => { actions.push(message); run.child.stdin.write(JSON.stringify(message) + "\n"); };
  const selectAfter = async (offset, title) => {
    await wait(() => run.messages.slice(offset).some(m => m.type === "extension_ui_request" && m.method === "select" && m.title.includes(title)), title);
    return run.messages.slice(offset).find(m => m.type === "extension_ui_request" && m.method === "select" && m.title.includes(title));
  };
  const file = join(run.workspace, "proof.txt");
  send({ id: "deny-write", type: "prompt", message: "WRITE_PROOF denied" });
  const approval = await selectAfter(0, "Allow Pi to run write?");
  assert.equal(existsSync(file), false);
  send({ type: "extension_ui_response", id: approval.id, value: "Deny" });
  await wait(() => run.messages.some(m => m.type === "agent_end"), "Denied RPC turn finished");
  assert.equal(existsSync(file), false);
  assert.match(run.stdout, /Blocked by user/);
  results.push({ label: "rpc-deny", passed: true, fileExists: false });

  let offset = run.messages.length;
  send({ id: "cancel-full", type: "prompt", message: "/permissions full" });
  const cancelled = await selectAfter(offset, "Enable Full access?");
  send({ type: "extension_ui_response", id: cancelled.id, cancelled: true });
  await wait(() => run.messages.some(m => m.type === "response" && m.id === "cancel-full"), "Cancelled full command finished");
  offset = run.messages.length;
  send({ id: "write-after-cancel", type: "prompt", message: "WRITE_PROOF still-default" });
  const stillDefault = await selectAfter(offset, "Allow Pi to run write?");
  assert.equal(existsSync(file), false);
  send({ type: "extension_ui_response", id: stillDefault.id, value: "Deny" });
  await wait(() => run.messages.slice(offset).some(m => m.type === "agent_end"), "Second denied turn finished");
  results.push({ label: "rpc-cancel-full", passed: true, stillRequiresApproval: true });

  offset = run.messages.length;
  send({ id: "accept-full", type: "prompt", message: "/permissions full" });
  const full = await selectAfter(offset, "Enable Full access?");
  assert.ok(full.options.includes("Yes, continue anyway"));
  send({ type: "extension_ui_response", id: full.id, value: "Yes, continue anyway" });
  await wait(() => run.messages.some(m => m.type === "response" && m.id === "accept-full"), "Accepted full command finished");
  offset = run.messages.length;
  send({ id: "write-full", type: "prompt", message: "WRITE_PROOF approved" });
  await wait(() => run.messages.slice(offset).some(m => m.type === "agent_end"), "Full access turn finished");
  assert.equal(readFileSync(file, "utf8"), "approved\n");
  assert.equal(run.messages.slice(offset).some(m => m.type === "extension_ui_request" && m.method === "select"), false);
  results.push({ label: "rpc-accept-full", passed: true, bytes: readFileSync(file, "utf8") });
  run.child.stdin.end();
  await wait(() => run.child.exitCode !== null || run.child.signalCode !== null, "RPC EOF shutdown");
  await run.closed;
  assert.equal(run.child.exitCode, 0);
  passed = true;
} finally {
  for (const run of children) {
    run.cleanup = await stopProcessGroup(run.child);
    await run.closed;
    writeFileSync(join(evidence, `${run.label}.stdout.jsonl`), run.stdout);
    writeFileSync(join(evidence, `${run.label}.stderr`), run.stderr);
    cpSync(run.workspace, join(evidence, run.label), { recursive: true });
  }
  const processStopped = children.every(run => run.cleanup.groupStopped);
  writeFileSync(join(evidence, "journey.json"), JSON.stringify({ passed, processStopped, actions, results, events: records(),
    processes: children.map(run => ({ label: run.label, command: run.command, ...run.cleanup })) }, null, 2) + "\n");
  process.off("SIGTERM", interrupted); process.off("SIGINT", interrupted);
  assert.ok(processStopped, "Owned CLI process group remains alive");
}
