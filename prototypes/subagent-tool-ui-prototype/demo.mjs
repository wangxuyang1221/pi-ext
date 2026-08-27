import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionManager } from "@earendil-works/pi-coding-agent";

const prototypeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(prototypeDir, "../..");
const runDir = join(prototypeDir, ".tmp", `run-${process.pid}`);
const sessionDir = join(runDir, "session");
const cleanupRunDir = () => rmSync(runDir, { recursive: true, force: true });
process.on("exit", cleanupRunDir);

const ROBIE_ID = "01a03c0d-3c59-7efa-ac07-bb73090daa69";
const BOB_ID = "01a03c0d-3c5d-7bda-ae45-510a0b98fb6c";
const LIN_ID = "01a03c0d-3c61-7ad5-9c2b-61fd29ea4a01";

const agents = [
  agent(ROBIE_ID, "Robie", "running", 2, "pi-subagents:1"),
  agent(BOB_ID, "Bob", "settled", 1, "pi-subagents:2"),
  agent(LIN_ID, "Lin", "closed", 3),
];

const activity = [
  {
    kind: "tool",
    id: "tool-001",
    timestamp: "2026-08-26T10:42:01.000Z",
    toolName: "read",
    summary: "src/runtime.ts",
    result: "184 lines",
  },
  {
    kind: "tool",
    id: "tool-002",
    timestamp: "2026-08-26T10:42:04.000Z",
    toolName: "bash",
    summary: "npm test -- runtime",
    result: "12 tests passed",
  },
  {
    kind: "assistant",
    id: "assistant-001",
    timestamp: "2026-08-26T10:42:08.000Z",
    text: "The runtime boundary is isolated; the remaining risk is stale tmux window metadata after an external kill.",
    stopReason: "toolUse",
  },
  {
    kind: "tool",
    id: "tool-003",
    timestamp: "2026-08-26T10:42:10.000Z",
    toolName: "grep",
    summary: "tmux locator writes",
    result: "4 matches",
  },
  {
    kind: "assistant",
    id: "assistant-002",
    timestamp: "2026-08-26T10:42:14.000Z",
    text: "Audit complete. Recommend validating the pane PID before every prompt and treating a mismatch as interrupted.",
    stopReason: "stop",
  },
];

const calls = [
  call("spawn", "subagent_spawn", {
    task: "Audit the runtime ownership boundary and report only actionable race conditions.",
    name: "Robie",
    model: "gpt-5.6-sol",
    thinkingLevel: "high",
  }, {
    operation: "spawn",
    ok: true,
    agent: { ...agents[0], generation: 1 },
    task: "Audit the runtime ownership boundary and report only actionable race conditions.",
  }),
  call("resume", "subagent_resume", {
    agentId: LIN_ID,
  }, {
    operation: "resume",
    ok: true,
    agent: { ...agents[2], status: "running", generation: 4 },
  }),
  call("prompt", "subagent_prompt", {
    agentId: ROBIE_ID,
    text: "Also verify how an externally killed tmux pane is detected.",
    delivery: "steer",
  }, {
    operation: "prompt",
    ok: true,
    agent: agents[0],
    prompt: "Also verify how an externally killed tmux pane is detected.",
    delivery: "steer",
  }),
  call("list", "subagent_list", {}, {
    operation: "list",
    ok: true,
    agents,
  }),
  call("read", "subagent_read", {
    agentId: ROBIE_ID,
    view: "recent_activity",
    assistantLimit: 2,
    toolLimit: 3,
  }, {
    operation: "read",
    ok: true,
    agent: agents[0],
    view: "recent_activity",
    assistantCount: 2,
    toolCount: 3,
    cursor: "activity:epoch-7:000042",
    activity,
  }),
  call("wait", "subagent_wait", {
    agentId: ROBIE_ID,
    afterSettled: "settled:epoch-7:generation-1",
    timeoutMs: 30_000,
    assistantLimit: 2,
    toolLimit: 3,
  }, {
    operation: "wait",
    ok: true,
    agent: { ...agents[0], status: "settled", generation: 2 },
    outcome: "settled",
    durationMs: 8_400,
    settledCursor: "settled:epoch-7:generation-2",
    cursor: "activity:epoch-7:000042",
    activity: activity.slice(-2),
  }),
  call("close", "subagent_close", {
    target: "all",
  }, {
    operation: "close",
    ok: true,
    affected: agents.map((item) => ({ ...item, status: "closed" })),
    relationshipRetained: true,
    piSessionRetained: true,
  }),
  call("forget", "subagent_forget", {
    target: LIN_ID,
  }, {
    operation: "forget",
    ok: true,
    agent: { ...agents[2], status: "closed" },
    affected: [{ ...agents[2], status: "closed" }],
    relationshipRetained: false,
    extensionDataRemoved: true,
    piSessionRetained: true,
  }),
];

await mkdir(sessionDir, { recursive: true });
const manager = SessionManager.create(repoRoot, sessionDir);
manager.appendSessionInfo("Subagent tool UI prototype");
manager.appendMessage({
  role: "user",
  content: "Subagent tool renderer fixture — press Ctrl+O to expand tool details.",
  timestamp: Date.now(),
});
manager.appendMessage({
  role: "assistant",
  content: calls.map((item) => ({
    type: "toolCall",
    id: item.id,
    name: item.name,
    arguments: item.arguments,
  })),
  api: "openai-codex-responses",
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  usage: emptyUsage(),
  stopReason: "toolUse",
  timestamp: Date.now() + 1,
});
for (const item of calls) {
  manager.appendMessage({
    role: "toolResult",
    toolCallId: item.id,
    toolName: item.name,
    content: [{ type: "text", text: JSON.stringify(item.details, null, 2) }],
    details: item.details,
    isError: false,
    timestamp: Date.now() + 2,
  });
}

const sessionFile = manager.getSessionFile();
if (!sessionFile) throw new Error("Demo session was not persisted.");

const piBin = process.env.PI_BIN || "pi";
const piArgs = [
  "--no-extensions",
  "--extension", join(repoRoot, "extensions/codex-ui/src/index.ts"),
  "--extension", join(prototypeDir, "index.ts"),
  "--theme", join(repoRoot, "themes/codex-pi.json"),
  "--use-theme", "codex-pi",
  "--session", sessionFile,
  "--no-context-files",
  "--no-skills",
  "--no-prompt-templates",
  "--offline",
  "--approve",
];

try {
  const exit = await runChild(piBin, piArgs);
  if (exit.signal) {
    process.exitCode = 128;
  } else {
    process.exitCode = exit.code ?? 1;
  }
} finally {
  cleanupRunDir();
  process.off("exit", cleanupRunDir);
}

function call(id, name, arguments_, details) {
  return { id: `demo-${id}`, name, arguments: arguments_, details };
}

function agent(agentId, name, status, generation, tmuxWindow) {
  return {
    agentId,
    name,
    status,
    generation,
    model: "gpt-5.6-sol",
    thinkingLevel: "high",
    tmuxWindow,
    sessionFile: `~/.pi/agent/sessions/…/${agentId.slice(0, 8)}.jsonl`,
  };
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function runChild(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });
    const handlers = new Map();
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => child.kill(signal);
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.once("error", (error) => {
      cleanup();
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolvePromise({ code, signal });
    });
  });
}
