import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { archiveEvidence, createRunEvidence, finishOutput, snapshotFixtures, stopRecordedPtyOwners } from "./runtime-support.mjs";

function fixture() {
  const root = mkdtempSync(resolve(".tmp/archive-regression-"));
  for (const directory of [".tmp/test-results", "scratch/home/.pi", "scratch/agent", "scratch/sessions", "evidence"]) mkdirSync(join(root, directory), { recursive: true });
  return { root, scratch: join(root, "scratch"), evidence: join(root, "evidence") };
}

test("archives ordinary evidence beside a live Unix socket without copying the socket", async () => {
  const context = fixture();
  const socket = join(context.scratch, "agent/socket");
  const server = createServer();
  try {
    server.listen(relative(process.cwd(), socket));
    await once(server, "listening");
    writeFileSync(join(context.scratch, "agent/ordinary.json"), '{"retained":true}');
    const result = archiveEvidence({ repo: context.root, ...context, before: new Map() });
    assert.deepEqual(result.errors, []);
    assert.ok(result.skipped.includes(socket));
    assert.equal(existsSync(join(context.evidence, "agent/socket")), false);
    assert.equal(readFileSync(join(context.evidence, "agent/ordinary.json"), "utf8"), '{"retained":true}');
    assert.equal(server.listening, true, "Archival must not stop the owned service");
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("archives goal footer, legacy proof and isolated home into each run", () => {
  const context = fixture();
  try {
    const before = snapshotFixtures(context.root);
    const footer = join(context.root, ".tmp/goal-footer-acceptance-native.json");
    writeFileSync(footer, '{"screen":"first"}');
    writeFileSync(join(context.root, ".tmp/test-results/verify-123-pty-native.json"), '{"passed":true}');
    writeFileSync(join(context.scratch, "home/.pi/pi-codex-search.json"), '{"enabled":false}');
    const first = archiveEvidence({ repo: context.root, ...context, before });
    assert.deepEqual(first.errors, []);
    assert.equal(readFileSync(join(context.evidence, "home/.pi/pi-codex-search.json"), "utf8"), '{"enabled":false}');
    assert.equal(readFileSync(join(context.evidence, "artifacts/goal-footer-acceptance-native.json"), "utf8"), '{"screen":"first"}');
    assert.ok(existsSync(join(context.evidence, "artifacts/verify-123-pty-native.json")));
    const secondBefore = snapshotFixtures(context.root);
    writeFileSync(footer, '{"screen":"second, longer"}');
    const secondEvidence = join(context.root, "second-evidence");
    mkdirSync(secondEvidence);
    archiveEvidence({ ...context, repo: context.root, evidence: secondEvidence, before: secondBefore });
    rmSync(context.scratch, { recursive: true });
    assert.equal(readFileSync(join(context.evidence, "artifacts/goal-footer-acceptance-native.json"), "utf8"), '{"screen":"first"}');
    assert.equal(readFileSync(join(secondEvidence, "artifacts/goal-footer-acceptance-native.json"), "utf8"), '{"screen":"second, longer"}');
  } finally { rmSync(context.root, { recursive: true, force: true }); }
});

test("archives explicitly reported proof nested in an existing fixture directory", () => {
  const context = fixture();
  try {
    const directory = join(context.root, ".tmp/test-results/legacy-proof");
    mkdirSync(directory);
    writeFileSync(join(directory, "screen.json"), "old");
    const before = snapshotFixtures(context.root);
    writeFileSync(join(directory, "screen.json"), "new proof");
    archiveEvidence({ repo: context.root, ...context, before, reportedEvidence: [directory] });
    assert.equal(readFileSync(join(context.evidence, "artifacts/reported/legacy-proof/screen.json"), "utf8"), "new proof");
  } finally { rmSync(context.root, { recursive: true, force: true }); }
});

test("ignores unrelated temporary files and never follows symlinks or copies output into itself", () => {
  const context = fixture();
  try {
    const before = snapshotFixtures(context.root);
    writeFileSync(join(context.root, ".tmp/unrelated.txt"), "Other task");
    writeFileSync(join(context.root, ".tmp/goal-footer-acceptance-native.json"), "Other case proof");
    const other = join(context.root, ".tmp/test-results/other-task");
    mkdirSync(other);
    writeFileSync(join(other, "private.json"), "Other task proof");
    symlinkSync(context.root, join(context.scratch, "home/recursive"));
    writeFileSync(join(context.evidence, "own.json"), "Already retained");
    const result = archiveEvidence({ ...context, repo: context.root, before, selected: "permissions",
      reportedEvidence: [context.evidence, join(context.evidence, "own.json"), join(context.root, ".tmp/test-results")] });
    assert.deepEqual(result.errors, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(existsSync(join(context.evidence, "home/recursive")), false);
    assert.equal(existsSync(join(context.evidence, "artifacts/unrelated.txt")), false);
    assert.equal(existsSync(join(context.evidence, "artifacts/goal-footer-acceptance-native.json")), false);
    assert.equal(existsSync(join(context.evidence, "artifacts/other-task")), false);
    assert.equal(existsSync(join(context.evidence, "artifacts/reported")), false);
  } finally { rmSync(context.root, { recursive: true, force: true }); }
});

test("a failed copy still archives sessions and fixed fixture proof", () => {
  const context = fixture();
  try {
    writeFileSync(join(context.evidence, "home"), "Conflicting destination");
    const before = snapshotFixtures(context.root);
    writeFileSync(join(context.scratch, "sessions/session.jsonl"), "session proof");
    writeFileSync(join(context.root, ".tmp/goal-footer-acceptance-native.json"), "footer proof");
    const result = archiveEvidence({ repo: context.root, ...context, before });
    assert.equal(result.errors.length, 1);
    assert.equal(readFileSync(join(context.evidence, "sessions/session.jsonl"), "utf8"), "session proof");
    assert.equal(readFileSync(join(context.evidence, "artifacts/goal-footer-acceptance-native.json"), "utf8"), "footer proof");
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("stops an explicitly recorded process group after its owner ignores SIGTERM", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const closed = once(child, "close");
  try {
    await once(child.stdout, "data");
    const stopped = await stopRecordedPtyOwners([child.pid]);
    assert.equal(stopped.groupStopped, true);
    await closed;
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await closed;
  }
});

test("releases only its own lock when evidence directory allocation fails", () => {
  const context = fixture();
  const lock = join(context.root, "verification.lock");
  try {
    const allocationError = new Error("Injected allocation failure");
    assert.throws(() => createRunEvidence({ lock, prefix: join(context.root, "proof-"), caseName: "metadata", allocate: () => { throw allocationError; } }), error => error === allocationError);
    assert.equal(existsSync(lock), false);
    writeFileSync(lock, '{"pid":42,"case":"other-run"}');
    assert.throws(() => createRunEvidence({ lock, prefix: join(context.root, "proof-"), caseName: "metadata" }), { code: "EEXIST" });
    assert.equal(readFileSync(lock, "utf8"), '{"pid":42,"case":"other-run"}');
  } finally { rmSync(context.root, { recursive: true, force: true }); }
});

test("bounded output cleanup destroys stuck owned streams and permits evidence archival", async () => {
  const context = fixture();
  const child = { stdout: new PassThrough(), stderr: new PassThrough() };
  const log = new Writable({ write(_chunk, _encoding, callback) { callback(); }, final() {} });
  try {
    const before = snapshotFixtures(context.root);
    writeFileSync(join(context.scratch, "sessions/proof.jsonl"), "Retained after output failure");
    await assert.rejects(finishOutput({ child, closed: new Promise(() => {}), log }, 25), error => error.errors.length === 2);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
    assert.equal(log.destroyed, true);
    const result = archiveEvidence({ repo: context.root, ...context, before });
    assert.deepEqual(result.errors, []);
    assert.equal(readFileSync(join(context.evidence, "sessions/proof.jsonl"), "utf8"), "Retained after output failure");
  } finally { child.stdout.destroy(); child.stderr.destroy(); log.destroy(); rmSync(context.root, { recursive: true, force: true }); }
});
