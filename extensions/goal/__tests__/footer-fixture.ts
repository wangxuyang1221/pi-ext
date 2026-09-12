import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import codexUi from "../../codex-ui/src/index.js";
import { registerGoal } from "../src/index.js";
import { GoalStore } from "../src/storage.js";

export default function fixture(pi: ExtensionAPI) {
  const root = process.env.GOAL_FOOTER_TEST_ROOT;
  if (!root) throw new Error("An isolated goal footer test root is required.");
  if (process.env.GOAL_FOOTER_NATIVE !== "1") codexUi(pi);
  let offset = 0;
  const store = new GoalStore(join(root, "goals"), () => performance.now() + offset);
  const tools = new Map<string, ToolDefinition>();
  pi.on("session_start", async (_event, ctx) => {
    const lease = await store.openSession({ ownerSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, sessionFile: ctx.sessionManager.getSessionFile()! });
    try {
      if (!lease.snapshot.goal) {
        const saved = await lease.replace("完成 goal extension 的界面改版", lease.snapshot, 80000);
        saved.goal!.elapsedSeconds = 775;
        saved.goal!.tokensUsed = 12345;
        saved.continuationDeferral = true;
        await store.commit(saved);
      }
    } finally { await lease.close(); }
  });
  // Only continuation delivery is a fixture. Storage, commands, UI and clocks are production code.
  registerGoal({ ...pi,
    registerTool(tool) { tools.set(tool.name, tool); pi.registerTool(tool); },
    sendMessage(message, options) {
      if (message.customType.startsWith("pi-ext-goal-") && options?.triggerTurn) return;
      pi.sendMessage(message, options);
    },
  }, store);
  pi.registerCommand("fixture-boundary", {
    description: "Advance the isolated display clock to two seconds before a minute",
    async handler(_args, ctx) {
      const tool = tools.get("get_goal")!;
      const result = await tool.execute("fixture-read", {}, new AbortController().signal, undefined, ctx);
      const seconds = (result.details as { goal: { timeUsedSeconds: number } }).goal.timeUsedSeconds;
      offset += ((58 - seconds % 60 + 60) % 60) * 1000;
      await tool.execute("fixture-clock", {}, new AbortController().signal, undefined, ctx);
    },
  });
  pi.registerCommand("fixture-complete", {
    description: "Complete the initial isolated fixture through the production tool",
    async handler(_args, ctx) { await tools.get("update_goal")!.execute("fixture-complete", { status: "complete" }, new AbortController().signal, undefined, ctx); },
  });
  pi.on("input", (_event, ctx) => { ctx.ui.notify("Offline fixture input intercepted.", "info"); return { action: "handled" }; });
  pi.on("user_bash", () => ({ result: { output: "Disabled in fixture.", exitCode: 0, cancelled: false, truncated: false } }));
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("before_provider_request", () => { throw new Error("Network is disabled in the goal footer fixture."); });
}
