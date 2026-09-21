import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import sourceSubagentExtension from "../../../extensions/subagent/src/index.js";

const subagentExtension = process.env.QUIT_PROBE_PRODUCT === "1"
  ? (await import("../../../extensions/subagent/dist/index.js")).default
  : sourceSubagentExtension;

/** Use production registrations; only expose their calls to the disposable quit adapter. */
export function installBackend(pi: ExtensionAPI) {
  const root = process.env.SKILL_PTY_ROOT!;
  const repo = process.env.QUIT_PROBE_REPO!;
  const registered = new Map<string, ToolDefinition<any>>();
  const record = (type: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), `${JSON.stringify({ type, data })}\n`);
  const intercepted = new Proxy(pi, {
    get(target, key) {
      if (key === "registerTool") return (tool: ToolDefinition<any>) => { registered.set(tool.name, tool); target.registerTool(tool); };
      return Reflect.get(target, key, target);
    },
  });
  subagentExtension(intercepted, {
    stateRoot: join(root, "state"), nativeSessionRoot: join(root, "children"),
    tmuxPath: join(root, "tmux"), tmuxSessionName: "probe-agents", piPath: join(root, "pi"),
    extensionPath: resolve(repo, "extensions/subagent/__tests__/fixtures/offline-child.ts"),
  });
  const call = async (name: string, args: any, ctx: ExtensionContext) => {
    const tool = registered.get(name)!;
    const result = await tool.execute("quit-probe", args, undefined, undefined, ctx);
    return JSON.parse(result.content.filter(part => part.type === "text").map(part => part.text).join(""));
  };
  pi.registerCommand("probe-spawn", { handler: async (args, ctx) => {
    try {
      const result = await call("subagent_spawn", { task: args || "fast work", model: "subagent-fixture/deterministic" }, ctx);
      record("probe-spawn", result.agent);
    } catch (error) { record("probe-spawn-error", String(error)); ctx.ui.notify(String(error), "error"); }
  } });
  return {
    list: (ctx: ExtensionContext) => call("subagent_list", {}, ctx),
    close: (ctx: ExtensionContext) => call("subagent_close", { target: "all" }, ctx),
  };
}
