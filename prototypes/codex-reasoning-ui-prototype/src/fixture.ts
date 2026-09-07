// PROTOTYPE: Scripted provider events; tool execution stays in the real isolated Pi loop.
import { setTimeout as delay } from "node:timers/promises";
import {
  createAssistantMessageEventStream,
  type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions,
  type ThinkingContent, type TextContent, type ToolCall,
} from "@earendil-works/pi-ai";

export const PROVIDER = "reasoning-ui-fixture";
export const MODEL = "local-demo";
export const PROMPTS = {
  standard: "播放标准思考演示。数据来自本地 fixture，不是性能实测。",
  long: "播放长文思考演示。数据来自本地 fixture，不是性能实测。",
} as const;
export const INPUT_FILE = "metrics.json";
export const OUTPUT_FILE = "report.md";
export const INPUT_DATA = '{"baseline":33.61,"candidate":62.55,"routed":62.98}\n';
export const REPORT = "# Fixture report\n\n这些数据只用于 UI 演示。\n\n- 基线：33.61 tokens/s\n- 对照：62.55 tokens/s\n\n待补充说明。\n";
export const CALLS = [
  { name: "read", arguments: { path: INPUT_FILE } },
  { name: "bash", arguments: { command: "node -e 'const fs=require(\"node:fs\");const d=JSON.parse(fs.readFileSync(\"metrics.json\",\"utf8\"));console.log(\"fixture ratio: \"+(d.candidate/d.baseline).toFixed(2))'" } },
  { name: "write", arguments: { path: OUTPUT_FILE, content: REPORT } },
  { name: "edit", arguments: { path: OUTPUT_FILE, edits: [{ oldText: "待补充说明。", newText: "演示完成。此文件不代表真实性能测试结论。" }] } },
] as const;

export function isFixtureCall(name: string, input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const normalized = (value: unknown): string => JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
  return CALLS.some(call => call.name === name && normalized(call.arguments) === normalized(input));
}

export function getScene(context: Context): { long: boolean; step: number } {
  let userIndex = -1;
  for (let i = context.messages.length - 1; i >= 0; i--) {
    if (context.messages[i]?.role === "user") { userIndex = i; break; }
  }
  const user = context.messages[userIndex];
  const text = user?.role === "user"
    ? typeof user.content === "string" ? user.content : user.content.filter(part => part.type === "text").map(part => part.text).join("")
    : "";
  return {
    long: text === PROMPTS.long,
    step: context.messages.slice(userIndex + 1).filter(message => message.role === "assistant" && message.stopReason === "toolUse").length,
  };
}

export function thinkingFor(step: number, long: boolean): string {
  const titles = [
    "Reading the local fixture",
    "Computing the ratio",
    "我现在补齐报告",
    long ? "检查中英文混排、较长的报告说明以及窄窗口下的自然换行" : "Preparing validation report",
    "核对结果与演示边界",
  ];
  const bodies = [
    "先读取隔离工作目录里的演示数据，不访问网络或真实会话。",
    "用固定的两组数字计算比值，然后把结果交给后续报告步骤。计算过程不代表模型吞吐量测量。",
    "保留正常回复与工具记录的阅读顺序，报告只写入本次演示的临时目录。",
    "补充报告的限制说明，避免把演示数据误读成性能结论。",
    "确认读、计算、写入与编辑步骤已经结束，再给出最终回复。",
  ];
  let body = bodies[step] ?? bodies[4];
  if (long && step === 3) body += "\n\n" +
    "这一段故意保留较长的中文正文和 English identifiers，用来观察终端从宽窗口缩到窄窗口后的真实换行。状态标题始终留在输入框上方的一行，历史正文则按可用宽度排版，而不是一律截断为最后一个段落。" +
    "\n\n**Checking the final paragraph**\n\n这是最后一段。前面的内容也应保留，不能只显示这一句。";
  return `**${titles[step] ?? titles[4]}**\n\n${body}`;
}

export function streamFixture(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  };
  const { step, long } = getScene(context);
  const pace = process.env.PI_REASONING_LAB_FAST === "1" ? 0.04 : 1;
  const wait = async (ms: number) => {
    options?.signal?.throwIfAborted();
    await delay(Math.max(1, Math.round(ms * pace)), undefined, { signal: options?.signal });
  };
  void (async () => {
    try {
      stream.push({ type: "start", partial: output });
      const thinking: ThinkingContent = { type: "thinking", thinking: "" };
      output.content.push(thinking);
      stream.push({ type: "thinking_start", contentIndex: 0, partial: output });
      const source = thinkingFor(step, long);
      const headerEnd = source.indexOf("\n\n");
      const fragments = [source.slice(0, 7), source.slice(7, headerEnd), source.slice(headerEnd)];
      for (const fragment of fragments) {
        await wait(200);
        thinking.thinking += fragment;
        stream.push({ type: "thinking_delta", contentIndex: 0, delta: fragment, partial: output });
      }
      // The quiet interval makes static status behavior observable without extra stream updates.
      await wait(step === 0 ? 2600 : 1600);
      stream.push({ type: "thinking_end", contentIndex: 0, content: source, partial: output });
      if (step === 2 || step >= CALLS.length) {
        const text: TextContent = { type: "text", text: "" };
        const index = output.content.length;
        output.content.push(text);
        stream.push({ type: "text_start", contentIndex: index, partial: output });
        const parts = step === 2 ? ["演示数据的比值约为 **1.86 倍**。", "接下来写入临时报告，并补充边界说明。"] :
          ["演示完成。\n\n", "- 实时思考只在输入框上方更新。\n- 已完成内容保留在历史中，允许自然换行。\n", "- `report.md` 只存在于本次隔离工作目录，退出后删除。\n\n这些数字是固定 fixture，不是性能实测。"];
        for (const fragment of parts) {
          await wait(300);
          text.text += fragment;
          stream.push({ type: "text_delta", contentIndex: index, delta: fragment, partial: output });
        }
        stream.push({ type: "text_end", contentIndex: index, content: text.text, partial: output });
      }
      const call = CALLS[step];
      if (call) {
        const block: ToolCall = { type: "toolCall", id: `reasoning-lab-${Date.now()}-${step}`, name: call.name, arguments: {} };
        const index = output.content.length;
        output.content.push(block);
        stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
        await wait(150);
        block.arguments = structuredClone(call.arguments);
        stream.push({ type: "toolcall_delta", contentIndex: index, delta: JSON.stringify(call.arguments), partial: output });
        stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
        output.stopReason = "toolUse";
      }
      options?.signal?.throwIfAborted();
      stream.push({ type: "done", reason: call ? "toolUse" : "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = options?.signal?.aborted ? "演示已中断。输入 /demo 可重新播放。" : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
}
