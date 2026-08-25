import assert from "node:assert/strict";
import { test } from "vitest";

import {
  APPROVAL_CHOICES,
  MODES,
  createPermissionState,
  formatApprovalPrompt,
  formatStatusTextForTheme,
  handleToolCall,
  sessionAllowKey,
} from "../src/permission-policy.js";

function createCtx({ cwd = "/repo", choices = [], env = {} } = {}) {
  const seenPrompts = [];
  const queue = [...choices];

  return {
    hasUI: true,
    cwd,
    env,
    ui: {
      async select(title) {
        seenPrompts.push(title);
        return queue.shift();
      },
      async editor() {
        return "";
      },
    },
    seenPrompts,
  };
}

test("bash 的 session allow 按 cwd 和 exact command 隔离", async () => {
  const state = createPermissionState({ initialMode: MODES.DEFAULT });
  const firstCtx = createCtx({
    cwd: "/repo",
    choices: [APPROVAL_CHOICES.ALLOW_THIS_SESSION],
  });

  await handleToolCall({ toolName: "bash", input: { command: "pnpm test" } }, firstCtx, state);

  const sameCommandCtx = createCtx({ cwd: "/repo", choices: [] });
  assert.equal(
    await handleToolCall({ toolName: "bash", input: { command: "pnpm test" } }, sameCommandCtx, state),
    undefined,
  );
  assert.equal(sameCommandCtx.seenPrompts.length, 0);

  const differentCommandCtx = createCtx({
    cwd: "/repo",
    choices: [APPROVAL_CHOICES.DENY],
  });
  assert.deepEqual(
    await handleToolCall({ toolName: "bash", input: { command: "pnpm build" } }, differentCommandCtx, state),
    { block: true, reason: "Blocked by user" },
  );
  assert.equal(differentCommandCtx.seenPrompts.length, 1);

  const differentCwdCtx = createCtx({
    cwd: "/other",
    choices: [APPROVAL_CHOICES.DENY],
  });
  assert.deepEqual(
    await handleToolCall({ toolName: "bash", input: { command: "pnpm test" } }, differentCwdCtx, state),
    { block: true, reason: "Blocked by user" },
  );
  assert.equal(differentCwdCtx.seenPrompts.length, 1);
});

test("write/edit 的 session allow 按规范化路径隔离", async () => {
  assert.equal(
    sessionAllowKey({ toolName: "write", input: { path: "./src/../src/app.ts" } }, { cwd: "/repo" }),
    "tool:write|path:/repo/src/app.ts",
  );
  assert.equal(
    sessionAllowKey({ toolName: "edit", input: { path: "/repo/src/app.ts" } }, { cwd: "/repo" }),
    "tool:edit|path:/repo/src/app.ts",
  );
  assert.equal(
    sessionAllowKey(
      { toolName: "write", input: { path: ".\\src\\..\\src\\app.ts" } },
      { cwd: "C:\\repo" },
    ),
    "tool:write|path:c:/repo/src/app.ts",
  );
});

test("MCP 的 session allow 按 server 和 tool 隔离", () => {
  assert.equal(
    sessionAllowKey({ toolName: "mcp__MultiFetch__fetch_json", input: { url: "https://example.com" } }, {}),
    "mcp:MultiFetch|tool:fetch_json",
  );
  assert.equal(
    sessionAllowKey({ toolName: "mcp__mysql_mcp_server__execute_sql", input: { query: "SELECT 1" } }, {}),
    "mcp:mysql_mcp_server|tool:execute_sql",
  );
});

test("subagent 编排工具在 Default permissions 下直接放行且不弹审批", async () => {
  for (const toolName of ["spawn_agent", "check_subagent", "wait_agent", "send_input", "close_agent"]) {
    const state = createPermissionState({ initialMode: MODES.DEFAULT });
    const ctx = createCtx({
      choices: [APPROVAL_CHOICES.DENY],
    });

    assert.equal(await handleToolCall({ toolName, input: {} }, ctx, state), undefined);
    assert.equal(ctx.seenPrompts.length, 0, `${toolName} should not request approval`);
  }
});

test("permissions state 默认初始化为 Full access", async () => {
  const state = createPermissionState();
  const ctx = createCtx({
    choices: [APPROVAL_CHOICES.DENY],
  });

  assert.equal(state.getMode(), MODES.FULL_ACCESS);
  assert.equal(
    await handleToolCall({ toolName: "bash", input: { command: "pnpm test" } }, ctx, state),
    undefined,
  );
  assert.equal(ctx.seenPrompts.length, 0);
});

test("PI_PERMISSIONS_MODE 可覆盖默认模式", () => {
  const state = createPermissionState({
    env: { PI_PERMISSIONS_MODE: "default" },
  });

  assert.equal(state.getMode(), MODES.DEFAULT);
});

test("Full access 状态以 dim 分隔符融入 footer", () => {
  const theme = {
    fg(color, text) {
      return `<${color}>${text}</${color}>`;
    },
  };

  assert.equal(formatStatusTextForTheme(MODES.FULL_ACCESS, theme), "<dim>· full access</dim>");
  assert.equal(formatStatusTextForTheme(MODES.DEFAULT, theme), undefined);
});

test("子 Pi 环境下审批文案说明 session allow 只作用于当前子 Pi 进程", () => {
  const prompt = formatApprovalPrompt(
    { toolName: "bash", input: { command: "pnpm test" } },
    "/repo",
    { env: { PI_SUBAGENT_ID: "sa_123" } },
  );

  assert.match(prompt, /subagent sa_123/);
  assert.match(prompt, /only this Pi process/);
});
