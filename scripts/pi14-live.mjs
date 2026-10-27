import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { inspectPiHost } from "./pi-host.mjs";
import { stopProcessGroup } from "./codex-compact-quality-process.mjs";

assert.ok(process.argv.includes("--live"), "Pass --live to run paid, real provider acceptance");
const dryRun = process.argv.includes("--dry-run");
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const continued = option("--continue");
assert.ok(!(continued && dryRun), "A live round cannot be continued as a dry run");
const stages = dryRun ? ["preflight", "preflight-tui"] : option("--stages")?.split(",") ?? ["seed", "resume", "fast", "goal", "mcp", "subagent", "search", "noncodex"];
assert.ok(stages.every(stage => ["preflight", "preflight-tui", "seed", "resume", "auto-switch", "fast", "goal", "mcp", "subagent", "search", "noncodex", "noncodex-goal"].includes(stage)));
const host = inspectPiHost();
assert.equal(host.versions["pi-coding-agent"], "1.4.0");
const repo = process.cwd();
await mkdir(resolve(".tmp"), { recursive: true });
const root = continued ? resolve(continued) : await mkdtemp(resolve(".tmp/pi14-live-"));
assert.ok(root.startsWith(`${resolve(".tmp")}/pi14-live-`), "Continuation must use an isolated live root");
const statePath = join(root, "budget.json");
const existingBudget = continued ? JSON.parse(await readFile(statePath, "utf8")) : undefined;
if (existingBudget) {
  assert.equal(existingBudget.maxRequests, 40); assert.equal(existingBudget.maxCompactions, 8);
  assert.ok(Date.now() < existingBudget.deadline, "The existing live round has expired");
}
const started = existingBudget ? existingBudget.deadline - 30 * 60_000 : Date.now(), deadline = started + 30 * 60_000;
const runId = continued ? `continue-${Date.now()}` : "";
const reportPath = join(root, runId ? `${runId}-summary.json` : "summary.json");
const agentDir = join(root, "agent");
const authPath = join(agentDir, "auth.json");
const socket = join(root, "tmux.sock");
const quote = text => `'${text.replaceAll("'", `'"'"'`)}'`;
const run = promisify(execFile);
let child, stopping = false;
const summary = { root, host, started: new Date(started).toISOString(), cases: [] };
const interrupt = () => { stopping = true; if (child?.pid) try { process.kill(-child.pid, "SIGTERM"); } catch {} };
process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
try {
  for (const dir of ["agent", "home", "work", "tmp", "cache", "config", "data", "state"]) await mkdir(join(root, dir), { recursive: true });
  if (!continued) await writeFile(statePath, JSON.stringify({ deadline, maxRequests: 40, maxCompactions: 8,
    requests: 0, compactions: 0, auxiliary: 0, allowedOrigins: dryRun ? [] : ["https://chatgpt.com", "https://auth.openai.com", "https://api.deepseek.com"], localOrigins: [] }));
  const original = dryRun ? { "openai-codex": { type: "oauth", access: `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline" } })).toString("base64url")}.offline`, refresh: "pi14-dryrun-refresh", expires: Date.now() + 3_600_000 } }
    : JSON.parse(await readFile(join(homedir(), ".pi/agent/auth.json"), "utf8"));
  const auth = Object.fromEntries(["openai-codex", "deepseek"].filter(name => original[name]).map(name => [name, original[name]]));
  assert.ok(auth["openai-codex"], "Existing Codex authorization is required");
  await writeFile(authPath, JSON.stringify(auth), { mode: 0o600, flag: "wx" });
  const tmux = (await run("/usr/bin/which", ["tmux"])).stdout.trim();
  const guard = resolve("scripts/pi14-live-network.mjs");
  const tmuxPath = join(root, "tmux"), piPath = join(root, "pi");
  await writeFile(tmuxPath, `#!/bin/sh\nexec ${quote(tmux)} -S ${quote(socket)} -f /dev/null "$@"\n`);
  await writeFile(piPath, `#!/bin/sh\nexport PI14_LIVE_STATE=${quote(statePath)}\nexport NODE_OPTIONS=${quote(`--import ${guard}`)}\nexec ${quote(process.execPath)} ${quote(host.cli)} --no-context-files --no-skills --no-prompt-templates --no-themes --no-approve "$@"\n`);
  await chmod(tmuxPath, 0o700); await chmod(piPath, 0o700);
  const extensions = JSON.parse(await readFile("package.json", "utf8")).pi.extensions.map(path => resolve(path));
  const settings = { defaultProjectTrust: "never", transport: "sse", cacheWarming: "off", retry: { enabled: false, provider: { maxRetries: 0 } }, compaction: { enabled: false },
    defaultProvider: "openai-codex", defaultModel: "gpt-5.6-sol", defaultThinkingLevel: "low", extensions };
  await writeFile(join(agentDir, "settings.json"), JSON.stringify(settings));
  await writeFile(join(agentDir, "pi-codex-compact.json"), JSON.stringify({ manualProjection: { hiddenTools: [] } }));
  await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpServers: { acceptance: { command: process.execPath,
    args: [resolve("scripts/pi14-live-mcp.mjs")], retry: { maxAttempts: 1, background: false } } } }));
  const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", TERM: "xterm-256color", SHELL: "/bin/sh",
    HOME: join(root, "home"), TMPDIR: join(root, "tmp"), XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), PI_CODING_AGENT_DIR: agentDir,
    PI14_LIVE_STATE: statePath, PI14_LIVE_ROOT: root, PI14_REPO: repo, NODE_OPTIONS: `--import ${guard}`,
    PI_SUBAGENT_PI_PATH: piPath, PI_SUBAGENT_TMUX_PATH: tmuxPath, PI_PERMISSIONS_MODE: "full-access",
    PI_MCP_CONFIG: join(root, "mcp.json"), PI_TELEMETRY: "0", PI_CODEX_WEB_SEARCH_MODEL: "gpt-5.6-sol", PYTHONDONTWRITEBYTECODE: "1" };
  console.log(JSON.stringify({ root, deadline: new Date(deadline).toISOString(), maxRequests: 40, maxCompactions: 8 }));
  for (const stage of stages) {
    if (stopping || Date.now() >= deadline) break;
    const stageStarted = Date.now();
    const budgetBefore = JSON.parse(await readFile(statePath, "utf8"));
    const worker = [process.execPath, resolve("scripts/pi14-live-worker.mjs"), stage];
    const command = ["goal", "noncodex", "noncodex-goal", "preflight-tui"].includes(stage)
      ? ["conda", "run", "--no-capture-output", "-n", "codex-py312", "python", resolve("scripts/pi14-live-pty.py"), ...worker] : worker;
    child = spawn(command[0], command.slice(1), { env, cwd: repo, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    const timer = setTimeout(interrupt, Math.max(1, deadline - Date.now()));
    const result = { stage, code: null, diagnosticBytes: 0 };
    summary.cases.push(result);
    try {
      const [code] = await once(child, "exit");
      const budgetAfter = JSON.parse(await readFile(statePath, "utf8"));
      Object.assign(result, { code, diagnosticBytes: Buffer.byteLength(stderr), elapsedMs: Date.now() - stageStarted,
        requests: budgetAfter.requests - budgetBefore.requests, compactions: budgetAfter.compactions - budgetBefore.compactions });
      const sanitize = text => {
        for (const credential of Object.values(auth)) for (const field of ["access", "refresh", "key"]) {
          if (typeof credential[field] === "string" && credential[field]) text = text.replaceAll(credential[field], "[REDACTED]");
        }
        return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
      };
      const prefix = runId ? `${stage}.${runId}` : stage;
      await writeFile(join(root, `${prefix}.jsonl`), sanitize(stdout));
      await writeFile(join(root, `${prefix}.diagnostic.log`), sanitize(stderr));
      console.log(JSON.stringify(result));
    } finally {
      clearTimeout(timer);
      result.cleanup = await stopProcessGroup(child);
      child = undefined;
    }
  }
} catch (error) {
  summary.setupFailure = error.name;
  process.exitCode = 1;
} finally {
  interrupt();
  if (child?.pid) await stopProcessGroup(child);
  const tmuxPath = join(root, "tmux");
  await run(tmuxPath, ["kill-server"]).catch(() => {});
  const remaining = await run(tmuxPath, ["list-sessions"]).then(() => true, () => false);
  assert.equal(remaining, false, "Owned tmux server still running");
  await rm(authPath, { force: true });
  // Includes any per-child authentication-environment files and refreshed tokens.
  await rm(agentDir, { recursive: true, force: true });
  summary.credentialsRemoved = true;
  summary.budget = await readFile(statePath, "utf8").then(JSON.parse).catch(() => undefined);
  summary.elapsedMs = Date.now() - started;
  await writeFile(reportPath, JSON.stringify(summary, null, 2));
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  if (summary.cases.some(item => item.code !== 0) || summary.cases.length !== stages.length) process.exitCode = 1;
  console.log(JSON.stringify({ report: reportPath, requests: summary.budget?.requests, compactions: summary.budget?.compactions, credentialsRemoved: true }));
}
