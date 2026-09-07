// FIXTURE: Load production directly; retain proposed as a frozen-tool composition reference.
import { appendFileSync } from "node:fs";
import type { ExtensionAPI, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { ReasoningStatus, extractTitle, historyMarkdown } from "./status.js";
import { PROVIDER, MODEL, PROMPTS, isFixtureCall, streamFixture } from "./fixture.js";

export default function reasoningLab(pi: ExtensionAPI): void {
  const proposed = process.env.PI_REASONING_LAB_VARIANT === "proposed";
  const production = process.env.PI_REASONING_LAB_VARIANT === "production";
  const trace = (event: Record<string, unknown>) => {
    const path = process.env.PI_REASONING_LAB_TRACE;
    if (path) appendFileSync(path, JSON.stringify(event) + "\n");
  };
  codexUi(proposed ? new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerMarkdownTransformer") return (transformer: MarkdownTransformer) => {
        target.registerMarkdownTransformer((markdown, context) => context.messageType === "assistant-thinking"
          ? markdown : transformer(markdown, context));
      };
      // The frozen baseline's agent_start handler owns only the terminal-title animation.
      if (property === "on") return (name: string, handler: (...args: never[]) => unknown) => {
        if (name !== "agent_start") (target.on as (name: string, handler: unknown) => void)(name, handler);
      };
      return Reflect.get(target, property, receiver);
    },
  }) : pi);

  let status: ReasoningStatus | undefined;
  let latestTitle = "";
  const setTitle = (title: string) => {
    if (title === latestTitle) return;
    latestTitle = title;
    status?.setTitle(title);
    trace({ type: "status", title });
  };
  if (proposed) pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant-thinking") return markdown;
    return context.isStreaming ? "" : historyMarkdown(markdown);
  });

  pi.registerProvider(PROVIDER, {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: MODEL, name: "Local reasoning UI demo", reasoning: true, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
    streamSimple: streamFixture,
  });
  pi.registerCommand("demo", {
    description: "Replay the thinking demo; use /demo long for long content",
    getArgumentCompletions: prefix => ["standard", "long"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("The demo is running. Press Esc to interrupt it first.", "info");
        return;
      }
      if (args.trim() && !["standard", "long"].includes(args.trim())) {
        ctx.ui.notify("Use /demo or /demo long.", "info");
        return;
      }
      const model = ctx.modelRegistry.find(PROVIDER, MODEL);
      if (!model || !await pi.setModel(model)) throw new Error("Fixture model is unavailable.");
      pi.sendUserMessage(args.trim() === "long" ? PROMPTS.long : PROMPTS.standard);
    },
  });
  pi.on("input", (event, ctx) => {
    if (Object.values(PROMPTS).includes(event.text as typeof PROMPTS.standard)) return { action: "continue" };
    ctx.ui.notify("Offline prototype: use /demo or /demo long. Free-form input is not sent.", "info");
    return { action: "handled" };
  });
  pi.on("tool_call", event => {
    if (!event.toolCallId.startsWith("reasoning-lab-") || !isFixtureCall(event.toolName, event.input)) {
      return { block: true, reason: "Only exact isolated fixture operations are allowed." };
    }
    trace({ type: "tool", name: event.toolName });
  });
  pi.on("user_bash", () => ({ result: {
    output: "User shell commands are disabled in this prototype.", exitCode: 1, cancelled: false, truncated: false,
  } }));
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    pi.setActiveTools(["read", "bash", "write", "edit"]);
    if (proposed) {
      ctx.ui.setWorkingIndicator({ frames: [] });
      ctx.ui.setWorkingVisible(false);
      ctx.ui.setWidget("reasoning-lab-status", (tui) => {
        status = new ReasoningStatus(() => ctx.ui.theme, () => tui.requestRender());
        status.setTitle(latestTitle);
        return status;
      });
    }
    ctx.ui.setWidget("reasoning-lab-help", (_tui, theme) => new Text(
      theme.fg("dim", `${proposed ? "Alignment preview" : production ? "Production reference" : "Legacy reference"} · /demo replay · /demo long · Esc interrupt · Ctrl+D exit`),
      1, 0,
    ), { placement: "belowEditor" });
    trace({ type: "ready", proposed, sessionFile: ctx.sessionManager.getSessionFile?.() });
  });
  pi.on("message_start", event => {
    if (proposed && event.message.role === "assistant") setTitle("Thinking");
  });
  pi.on("message_update", event => {
    if (!proposed || event.message.role !== "assistant") return;
    const update = event.assistantMessageEvent;
    if (update.type === "thinking_delta") {
      const block = event.message.content[update.contentIndex];
      const title = block?.type === "thinking" ? extractTitle(block.thinking) : undefined;
      if (title) setTitle(title);
    } else if (update.type === "text_start") setTitle("Preparing response");
  });
  pi.on("tool_execution_start", event => {
    if (proposed) setTitle(`Running ${event.toolName}`);
  });
  pi.on("agent_settled", () => {
    if (proposed) setTitle("");
    trace({ type: "settled" });
  });
  pi.on("session_shutdown", () => {
    status?.setTitle("");
    status = undefined;
    latestTitle = "";
  });
}
