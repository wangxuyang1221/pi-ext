import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { basename, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function createRunEvidence({ lock, prefix, caseName, allocate = mkdtempSync }) {
  writeFileSync(lock, JSON.stringify({ pid: process.pid, case: caseName }), { flag: "wx" });
  try { return allocate(prefix); }
  catch (error) {
    if (JSON.parse(readFileSync(lock, "utf8")).pid === process.pid) rmSync(lock);
    throw error;
  }
}

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function finishOutput({ child, closed, log }, timeoutMs = 3000) {
  const errors = [];
  try { if (closed) await bounded(closed, timeoutMs, "Driver output did not close"); }
  catch (error) {
    errors.push(error);
    child?.stdout?.destroy();
    child?.stderr?.destroy();
  }
  try {
    if (log && !log.writableFinished) {
      const finished = once(log, "finish");
      log.end();
      await bounded(finished, timeoutMs, "Verification log did not finish");
    }
  } catch (error) { errors.push(error); log?.destroy(); }
  if (errors.length) throw new AggregateError(errors, errors.map(error => String(error)).join("; "));
}

export async function stopRecordedPtyOwners(pids) {
  const alive = pid => {
    try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
  };
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid recorded PTY owner PID");
    if (alive(pid)) {
      try { process.kill(-pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
  const deadline = performance.now() + 1000;
  while (pids.some(alive) && performance.now() < deadline) await delay(20);
  for (const pid of pids) if (alive(pid)) {
    try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const killDeadline = performance.now() + 3000;
  while (pids.some(alive) && performance.now() < killDeadline) await delay(20);
  if (pids.some(alive)) throw new Error("Recorded PTY process group cleanup not verified");
  return { pids, groupStopped: true };
}

const fixedProof = [
  { cases: ["goal-footer"], pattern: /^goal-footer-acceptance-[\w-]+\.json$/ },
  { cases: ["codex-ui", "codex-ui-fullscreen"], pattern: /^codemode-production-(regular|fullscreen)\.json$/ },
  { cases: ["thinking"], pattern: /^thinking-production-failed\.ansi$/ },
  { cases: ["tool-status"], pattern: /^tool-status-(smoke-[\w-]+\.json|last\.ansi)$/ },
  { cases: ["search"], pattern: /^web-search-production-(regular|fullscreen)-smoke\.json$/ },
];

// Only known legacy filenames are discovered. New fixtures report their unique output path.
export function fixtureFiles(repo, selected) {
  const temporary = join(repo, ".tmp");
  const results = join(temporary, "test-results");
  const files = readdirSync(temporary, { withFileTypes: true })
    .filter(item => item.isFile() && fixedProof.some(rule => (!selected || rule.cases.includes(selected)) && rule.pattern.test(item.name)))
    .map(item => join(temporary, item.name));
  if ((!selected || selected === "skills") && existsSync(results)) files.push(...readdirSync(results, { withFileTypes: true })
    .filter(item => item.isFile() && /^verify-\d+-pty-[\w-]+\.json$/.test(item.name)).map(item => join(results, item.name)));
  return files;
}

function fingerprint(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
    return stat.isDirectory() ? readdirSync(path).sort().map(name => `${name}:${fingerprint(join(path, name))}`).join("\n") : `${stat.mtimeMs}:${stat.size}`;
  } catch (error) { if (error.code === "ENOENT") return "missing"; throw error; }
}

export function snapshotFixtures(repo, selected) {
  return new Map(fixtureFiles(repo, selected).map(path => [path, fingerprint(path)]));
}

export function reportedEvidencePaths(logPath) {
  if (!existsSync(logPath)) return [];
  return [...new Set(readFileSync(logPath, "utf8").split("\n").flatMap(line => {
    try {
      const value = JSON.parse(line.trim());
      return typeof value.evidence === "string" ? [value.evidence] : [];
    } catch { return []; }
  }))];
}

export function archiveEvidence({ repo, scratch, evidence, before, selected, reportedEvidence = [] }) {
  const copied = [], errors = [], skipped = [];
  const attempt = (source, target) => {
    try {
      if (!existsSync(source)) return;
      cpSync(source, target, { recursive: true, force: true, dereference: false, filter: path => {
        const stat = lstatSync(path);
        if (stat.isFile() || stat.isDirectory()) return true;
        skipped.push(path);
        return false;
      } });
      copied.push(resolve(target));
    } catch (error) { errors.push({ source, error: String(error) }); }
  };
  // Copy isolated configuration even when the PTY driver failed before its finally.
  if (scratch) for (const name of ["home", "agent", "sessions", "workspace", "state", "config", "events.jsonl", "responses.json", "responses-cursor.json"]) {
    attempt(join(scratch, name), join(evidence, name));
  }
  mkdirSync(join(evidence, "artifacts"), { recursive: true });
  for (const file of fixtureFiles(repo, selected)) {
    try {
      if (!before.has(file) || fingerprint(file) !== before.get(file)) attempt(file, join(evidence, "artifacts", basename(file)));
    } catch (error) { errors.push({ source: file, error: String(error) }); }
  }
  const results = resolve(repo, ".tmp/test-results");
  for (const source of reportedEvidence.map(path => resolve(repo, path))) {
    const name = relative(results, source);
    const relativeToEvidence = relative(evidence, source);
    // Nested output already lives in this run; ancestors must never be copied into themselves.
    if (!name || name.startsWith(`..${sep}`) || name === ".." || !relativeToEvidence || !relativeToEvidence.startsWith(`..${sep}`) || resolve(evidence).startsWith(source + sep)) continue;
    attempt(source, join(evidence, "artifacts/reported", name));
  }
  return { copied, errors, skipped };
}
