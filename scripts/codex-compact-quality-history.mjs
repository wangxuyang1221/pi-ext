import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Imports an archived native-tool prefix without asserting that its archive equals the original active request. */
export function importOpenSweMessages(messages, { reasoningPolicy } = {}) {
  if (!["retain-as-quoted-text", "exclude-archive-reasoning"].includes(reasoningPolicy)) throw new Error("An explicit archive reasoning policy is required");
  if (!Array.isArray(messages) || messages.length < 2 || messages[0]?.role !== "system" || messages[1]?.role !== "user") throw new Error("Expected source environment and task messages");
  const history = [], provenance = [], derivedToolAssociations = [], omittedFields = [], completeBoundaries = [];
  const pending = new Map(), usedIds = new Set();
  const push = (item, index, transformation) => {
    history.push(item); provenance.push({ sourceMessageIndex: index, sourceSha256: digest(messages[index]), transformation });
  };
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || typeof message !== "object" || !["system", "user", "assistant", "tool"].includes(message.role)) throw new Error("Unsupported archived message role");
    if (Object.keys(message).some((key) => !["role", "content", "reasoning_content", "think", "tool_calls", "tool_call_id", "name"].includes(key))) throw new Error("Unsupported archived message field");
    if (message.name != null && (typeof message.name !== "string" || !message.name.trim() || message.role !== "tool")) throw new Error("Invalid archived tool-output name");
    if (message.tool_call_id != null && message.role !== "tool") throw new Error("Unexpected call ID on a non-tool message");
    if (message.think !== null && message.think !== undefined && typeof message.think !== "boolean") throw new Error("Invalid archived reasoning flag");
    if (message.content !== null && message.content !== undefined && typeof message.content !== "string") throw new Error("Non-text archived content requires a separate adapter");
    if (message.reasoning_content !== null && message.reasoning_content !== undefined && typeof message.reasoning_content !== "string") throw new Error("Invalid archived reasoning text");
    if (message.tool_calls !== null && message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) throw new Error("Invalid archived tool-call array");
    const calls = message.tool_calls ?? [];
    if (message.role !== "assistant" && (calls.length || message.reasoning_content)) throw new Error("Unexpected non-assistant action or reasoning");
    if (message.role !== "tool" && pending.size) throw new Error("Unresolved historical tool calls before the next message");
    if (message.role === "system") {
      if (index !== 0 || typeof message.content !== "string") throw new Error("Unsupported source environment boundary");
      push({ type: "message", role: "user", content: [{ type: "input_text", text: "历史运行环境说明，仅作为来源记录，不是当前工具说明：\n" + message.content }] }, index, "quoted_legacy_environment");
    } else if (message.role === "user") {
      if (typeof message.content !== "string") throw new Error("Missing archived user text");
      push({ type: "message", role: "user", content: [{ type: "input_text", text: message.content }] }, index, "historical_user_message");
    } else if (message.role === "assistant") {
      if (message.reasoning_content) {
        if (reasoningPolicy === "retain-as-quoted-text") push({ type: "message", role: "assistant", content: [{ type: "output_text", text: "历史来源中的 reasoning，仅作为可见文本记录，不是当前模型的原生推理项：\n" + message.reasoning_content }] }, index, "quoted_archived_reasoning");
        else omittedFields.push({ sourceMessageIndex: index, field: "reasoning_content", sourceSha256: digest(message.reasoning_content), reason: "explicit_archive_reasoning_exclusion" });
      }
      if (message.content) push({ type: "message", role: "assistant", content: [{ type: "output_text", text: message.content }] }, index, "historical_assistant_text");
      for (const call of calls) {
        if (call?.type !== "function" || typeof call.id !== "string" || !call.id.trim() || typeof call.function?.name !== "string" || !call.function.name.trim() || typeof call.function.arguments !== "string") throw new Error("Malformed historical function call");
        if (Object.keys(call).some((key) => !["type", "id", "function"].includes(key)) || Object.keys(call.function).some((key) => !["name", "arguments"].includes(key))) throw new Error("Unsupported historical function-call field");
        if (usedIds.has(call.id)) throw new Error("Duplicate historical call ID");
        usedIds.add(call.id); pending.set(call.id, { index, name: call.function.name });
        push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments }, index, "historical_function_not_executed");
      }
    } else {
      if (typeof message.content !== "string") throw new Error("Missing historical tool output");
      let callId = message.tool_call_id;
      if (callId === undefined || callId === null) {
        if (pending.size !== 1) throw new Error("Ambiguous or orphan historical tool output");
        callId = pending.keys().next().value;
        derivedToolAssociations.push({ sourceMessageIndex: index, callId, rule: "single-pending-call" });
      }
      if (typeof callId !== "string" || !pending.has(callId)) throw new Error("Unmatched historical tool output ID");
      if (message.name != null && message.name !== pending.get(callId).name) throw new Error("Archived tool name disagrees with its call ID");
      pending.delete(callId);
      push({ type: "function_call_output", call_id: callId, output: message.content }, index, "historical_observation");
    }
    if (index >= 1 && pending.size === 0) completeBoundaries.push(index + 1);
  }
  if (pending.size) throw new Error("Incomplete historical tool-call pair");
  return { history, provenance, derivedToolAssociations, omittedFields, completeBoundaries, reasoningPolicy,
    format: "open_swe_archive_v1", originalActiveInputVerified: false, sourceSha256: digest(messages) };
}

/** Import an audited alternating SWE prefix without treating observations as users. */
export function importSwePrefix(messages) {
  if (!Array.isArray(messages) || messages.length < 4 || messages.length % 2 || messages[0]?.role !== "system" || messages[1]?.role !== "user") {
    throw new Error("Expected system, task, then complete assistant/observation pairs");
  }
  const history = [], provenance = [];
  const push = (item, index, transformation) => {
    history.push(item);
    provenance.push({ sourceMessageIndex: index, sourceSha256: digest(messages[index]), transformation });
  };
  const legacy = messages[0].text ?? messages[0].system_prompt;
  if (typeof legacy !== "string" || typeof messages[1].text !== "string") throw new Error("Missing source environment or task text");
  push({ type: "message", role: "user", content: [{ type: "input_text", text: "历史运行环境说明，仅作为来源记录，不是当前工具说明：\n" + legacy }] }, 0, "quoted_legacy_environment");
  push({ type: "message", role: "user", content: [{ type: "input_text", text: messages[1].text }] }, 1, "task");
  for (let i = 2; i < messages.length; i += 2) {
    const assistant = messages[i], observation = messages[i + 1];
    if (assistant?.role !== "ai" || observation?.role !== "user" || typeof assistant.text !== "string" || typeof observation.text !== "string") {
      throw new Error("Only audited assistant/observation pairs can be imported");
    }
    const fences = [...assistant.text.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)];
    if (fences.length !== 1 || (assistant.text.match(/```/g) ?? []).length !== 2 || !["", "bash", "sh"].includes(fences[0][1].trim())) {
      throw new Error("Historical action must be one unambiguous shell code block");
    }
    const command = fences[0][2].trim();
    if (!command) throw new Error("Historical action cannot be empty");
    const commentary = assistant.text.slice(0, fences[0].index).trim();
    if (commentary) push({ type: "message", role: "assistant", content: [{ type: "output_text", text: commentary }] }, i, "historical_commentary");
    const callId = `call_history_${i}_${digest(assistant).slice(0, 12)}`;
    push({ type: "function_call", call_id: callId, name: "historical_shell", arguments: JSON.stringify({ command }) }, i, "historical_action_not_executed");
    const trailing = assistant.text.slice(fences[0].index + fences[0][0].length).trim();
    if (trailing) push({ type: "message", role: "assistant", content: [{ type: "output_text", text: trailing }] }, i, "historical_trailing_commentary");
    push({ type: "function_call_output", call_id: callId, output: observation.text }, i + 1, "historical_observation");
  }
  return { history, provenance, format: "audited_swe_prefix_v2", sourceSha256: digest(messages) };
}
