import { readFileSync } from "node:fs";
import { turnBoundaryCases } from "./codex-compact-boundary-cases.mjs";

export function fullEstimatorCases() {
  const text = { type: "input_text", text: "中文🙂\nstate: revised\t\u0000" };
  const variants = [
    { type: "additional_tools", role: "developer", tools: [{ type: "function", name: "inspect", parameters: { type: "object" } }] },
    { type: "message", role: "user", content: [text] },
    { type: "agent_message", author: "planner", recipient: "worker", content: [text, { type: "encrypted_content", encrypted_content: "中".repeat(300) }] },
    { type: "reasoning", summary: [] },
    { type: "local_shell_call", status: "completed", action: { type: "exec", command: ["echo", "x"] } },
    { type: "function_call", name: "read", call_id: "call_1", arguments: "{\"path\":\"a.ts\"}" },
    { type: "tool_search_call", execution: "client", arguments: { query: "look up" } },
    { type: "function_call_output", call_id: "call_1", output: "done" },
    { type: "custom_tool_call", call_id: "call_2", name: "patch", input: "*** End Patch" },
    { type: "custom_tool_call_output", call_id: "call_2", output: [text] },
    { type: "tool_search_output", status: "completed", execution: "client", tools: [] },
    { type: "web_search_call", action: { type: "search", query: "Codex" } },
    { type: "image_generation_call", status: "completed", result: "YWJj" },
    { type: "compaction", encrypted_content: "A".repeat(3000) },
    { type: "compaction_summary", encrypted_content: "A".repeat(3000) },
    { type: "configuration_update", reasoning: { effort: "medium" } },
    { type: "compaction_trigger" },
    { type: "context_compaction" },
    { type: "unknown_future_item", payload: "discarded by serde" },
  ];
  const cases = variants.flatMap((item) => [
    { name: `${item.type}/minimal`, items: [item] },
    { name: `${item.type}/unknown-fields`, items: [{ ...item, unrelated: "not part of the Rust schema" }] },
    { name: `${item.type}/common-metadata`, items: [{ ...item, id: "ri_1", internal_chat_message_metadata_passthrough: { turn_id: "t", create_time: 0.000001, content_item_kinds: ["user.text"] } }] },
    { name: `${item.type}/null-metadata`, items: [{ ...item, id: null, internal_chat_message_metadata_passthrough: null }] },
  ]);
  cases.push(
    { name: "message/optional-null", items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }], id: null, phase: null, internal_chat_message_metadata_passthrough: null }] },
    { name: "message/metadata-filter", items: [{ type: "message", role: "user", content: [text], internal_chat_message_metadata_passthrough: { turn_id: "turn", create_time: 1.25, content_item_kinds: ["invalid"], cell_id: "must-not-deserialize", executed_tool_calls: [], tool_calls_complete: true } }] },
    { name: "reasoning/empty-content", items: [{ type: "reasoning", summary: [], content: [], encrypted_content: null }] },
    { name: "reasoning/plaintext", items: [{ type: "reasoning", summary: [{ type: "summary_text", text: "remember X" }], content: [{ type: "reasoning_text", text: "infer Y" }] }] },
    { name: "reasoning/encrypted", items: [{ type: "reasoning", summary: [], encrypted_content: "中".repeat(1000) }] },
    { name: "function-output/encrypted", items: [{ type: "function_call_output", output: [{ type: "encrypted_content", encrypted_content: "A".repeat(1400) }] }] },
    { name: "custom-output/encrypted-is-not-discounted", items: [{ type: "custom_tool_call_output", call_id: "c", output: [{ type: "encrypted_content", encrypted_content: "A".repeat(1400) }] }] },
  );
  cases.push({ name: "reasoning/text-only-content", items: [{ type: "reasoning", summary: [], content: [{ type: "text", text: "omitted by upstream skip predicate" }] }] });
  for (const value of [0, 1e-7, 1e-6, 1e20, 1e21, 1.23456789e100]) cases.push({ name: `numbers/${value}`, items: [{ type: "tool_search_call", call_id: null, execution: "client", arguments: { value } }] });
  for (const action of [{ type: "search", query: null, queries: ["one", "two"], unknown: true }, { type: "open_page", url: "https://example.invalid" }, { type: "find_in_page", url: null, pattern: "needle" }, { type: "future_action", unknown: "ignored" }]) cases.push({ name: `web-action/${action.type}`, items: [{ type: "web_search_call", action }] });
  const image = (ext) => `data:image/${ext};base64,${readFileSync(new URL(`../extensions/codex-compact/__tests__/fixtures/media/patch-boundary.${ext}`, import.meta.url)).toString("base64")}`;
  const audio = (ext, mime) => `data:audio/${mime};base64,${readFileSync(new URL(`../extensions/codex-compact/__tests__/fixtures/media/one-second.${ext}`, import.meta.url)).toString("base64")}`;
  const media = [
    ...["png", "jpg", "gif", "webp", "tiff", "bmp"].map((ext) => ({ name: `image/${ext}`, part: { type: "input_image", image_url: image(ext), detail: "original" } })),
    { name: "image/resized", part: { type: "input_image", image_url: image("png") } },
    { name: "image/header-only", part: { type: "input_image", image_url: `data:image/png;base64,${Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex").toString("base64")}`, detail: "original" } },
    { name: "audio/extreme-duration", part: { type: "input_audio", audio_url: `data:audio/mp4;base64,${readFileSync(new URL("../extensions/codex-compact/__tests__/fixtures/media/extreme-duration.m4a", import.meta.url)).toString("base64")}` } },
    ...[["wav", "wav"], ["mp3", "mpeg"], ["m4a", "mp4"], ["webm", "webm"], ["ogg", "ogg"]].map(([ext, mime]) => ({ name: `audio/${ext}`, part: { type: "input_audio", audio_url: audio(ext, mime) } })),
    ...["data:audio/wav;base64,!!!!", "data:audio/flac;base64,YWJj", "data:audio/wav;base64,", "https://example.invalid/audio.wav", "data:audio/wav,abc"].map((url, index) => ({ name: `audio/fallback-${index}`, part: { type: "input_audio", audio_url: url } })),
  ];
  for (const { name, part } of media) {
    cases.push({ name: `${name}/message`, items: [{ type: "message", role: "user", content: [text, part] }] });
    for (const type of ["function_call_output", "custom_tool_call_output"]) cases.push({ name: `${name}/${type}`, items: [{ type, call_id: "c", output: [text, part] }] });
  }
  const extremeAudio = media.find((entry) => entry.name === "audio/extreme-duration").part;
  cases.push({ name: "history/saturated-audio", items: Array.from({ length: 5 }, () => ({ type: "message", role: "user", content: [extremeAudio] })) });
  cases.push({ name: "audio/saturated-with-encrypted-adjustment", items: [{ type: "function_call_output", output: [extremeAudio, { type: "encrypted_content", encrypted_content: "x".repeat(8000) }] }] });
  cases.push({ name: "history/mixed-prefix", instructions: "系统约束：只读，不修改数据库。", items: [variants[1], variants[5], variants[7], variants[13], variants[1], { type: "message", role: "assistant", content: [{ type: "output_text", text: "finished" }], phase: "final_answer" }] });
  for (const [name, tools] of [["absent", undefined], ["empty", []], ["nested", [{ type: "function", name: "lookup", description: "工具说明".repeat(100), parameters: { type: "object", properties: { query: { type: "string" } } } }]]]) cases.push({ name: `prefix/${name}`, instructions: "完整系统指令🙂\n只读。", tools, items: [variants[1], variants[5], variants[7]] });
  return [...cases, ...turnBoundaryCases()];
}
