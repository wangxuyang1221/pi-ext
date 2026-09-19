export function turnBoundaryCases() {
  const user = (text) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
  const oldReasoning = { type: "reasoning", summary: [], encrypted_content: "x".repeat(1000) };
  const newReasoning = { type: "reasoning", summary: [], encrypted_content: "y".repeat(2000) };
  const reply = { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] };
  const candidates = [];
  for (const [name, start, end] of [
    ["agents", "# AGENTS.md instructions", "</INSTRUCTIONS>"],
    ["environment", "<environment_context>", "</environment_context>"],
    ["skill", "<skill>", "</skill>"],
    ["shell", "<user_shell_command>", "</user_shell_command>"],
    ["aborted", "<turn_aborted>", "</turn_aborted>"],
    ["subagent", "<subagent_notification>", "</subagent_notification>"],
    ["plugins", "<recommended_plugins>", "</recommended_plugins>"],
  ]) {
    const text = `${start}body${end}`;
    for (const [variation, value] of [["exact", text], ["uppercase", text.toUpperCase()], ["trim", `\u0085\u2003${text}\u0085`], ["bom", `\ufeff${text}`], ["prefix", `quote ${text}`], ["suffix", `${text} unfinished`], ["missing-close", `${start}body`]]) candidates.push([`${name}/${variation}`, user(value)]);
  }
  for (const [name, text] of [
    ["external/valid", "<external_key>x</external_key>"],
    ["external/empty-key", "<external_>x</external_>"],
    ["external/wrong-key", "<external_key>x</external_other>"],
    ["external/case-sensitive", "<EXTERNAL_KEY>x</EXTERNAL_KEY>"],
    ["internal/valid", '<codex_internal_context source="goal_v2">x</codex_internal_context>'],
    ["internal/invalid-source", '<codex_internal_context source="Goal">x</codex_internal_context>'],
    ["internal/empty-source", '<codex_internal_context source="">x</codex_internal_context>'],
    ["internal/extra-attribute", '<codex_internal_context source="goal" extra="x">x</codex_internal_context>'],
    ["internal/legacy", "<goal_context>x</goal_context>"],
    ["internal/legacy-uppercase", "<GOAL_CONTEXT>x</GOAL_CONTEXT>"],
    ["warning/process", "Warning: The maximum number of unified exec processes you can keep open is 10"],
    ["warning/model", "Warning: Your account was flagged for potentially high-risk cyber activity extra"],
    ["warning/apply-patch", "Warning: apply_patch was requested via bash. Use the apply_patch tool instead of exec_command."],
    ["warning/apply-patch-incomplete", "Warning: apply_patch was requested via bash."],
    ["hook/valid", '<hook_prompt hook_run_id="run">next</hook_prompt>'],
    ["hook/alternate-root", '<different hook_run_id="run">next</different>'],
    ["hook/entity", '<hook_prompt hook_run_id="&#x31;">a &amp; b</hook_prompt>'],
    ["hook/cdata", '<hook_prompt hook_run_id="run"><![CDATA[a < b]]></hook_prompt>'],
    ["hook/nested", '<hook_prompt hook_run_id="run"><child>x</child>tail</hook_prompt>'],
    ["hook/empty", '<hook_prompt hook_run_id="run"/>'],
    ["hook/missing-id", '<hook_prompt>text</hook_prompt>'],
    ["hook/blank-id", '<hook_prompt hook_run_id="&#x85;">text</hook_prompt>'],
    ["hook/duplicate-id", '<hook_prompt hook_run_id="one" hook_run_id="two">text</hook_prompt>'],
    ["hook/bad-close", '<hook_prompt hook_run_id="run">text</wrong>'],
    ["hook/unknown-entity", '<hook_prompt hook_run_id="run">&unknown;</hook_prompt>'],
    ["hook/bom", '\ufeff<hook_prompt hook_run_id="run">text</hook_prompt>'],
    ["hook/declaration", '<?xml version="1.0"?><hook_prompt hook_run_id="run">text</hook_prompt>'],
    ["hook/leading-text", 'ordinary text <hook_prompt hook_run_id="run">text</hook_prompt>'],
    ["hook/leading-comment", '<!-- preface --><hook_prompt hook_run_id="run">text</hook_prompt>'],
    ["hook/namespace", '<h:hook_prompt xmlns:h="urn:test" hook_run_id="run">text</h:hook_prompt>'],
    ["hook/unknown-attribute", '<hook_prompt hook_run_id="run" other="ignored">text</hook_prompt>'],
    ["hook/double-root", '<hook_prompt hook_run_id="run">text</hook_prompt><ignored/>'],
    ["hook/whitespace-only-text", '<hook_prompt hook_run_id="run">   </hook_prompt>'],
    ["hook/text-before-after-child", '<hook_prompt hook_run_id="run">before<child/>after</hook_prompt>'],
  ]) candidates.push([name, user(text)]);
  const communication = { author: "/root/planner", recipient: "/root/worker", content: "start", trigger_turn: true };
  for (const [name, change] of [
    ["valid", {}], ["false-trigger", { trigger_turn: false }], ["morpheus", { author: "/morpheus" }],
    ["relative-path", { author: "planner" }], ["reserved-path", { author: "/root/root" }], ["bad-segment", { author: "/root/Upper" }],
    ["empty-segment", { author: "/root//worker" }], ["trailing-slash", { author: "/root/" }],
    ["bad-trigger", { trigger_turn: "true" }], ["missing-content", { content: undefined }],
    ["extra-recipient", { other_recipients: ["/root/observer"] }], ["invalid-recipient", { other_recipients: ["relative"] }],
    ["null-recipients", { other_recipients: null }], ["optional-null", { id: null, encrypted_content: null }],
    ["bad-optional", { encrypted_content: 4 }], ["unknown-field", { unknown: "ignored" }],
    ["bad-id", { id: 123 }], ["blank-content", { content: "" }], ["missing-trigger", { trigger_turn: undefined }],
    ["metadata", { internal_chat_message_metadata_passthrough: { turn_id: "t", create_time: 0.000001, content_item_kinds: ["user.text"], cell_id: 123, executed_tool_calls: "ignored" } }],
    ["metadata-invalid-kinds", { internal_chat_message_metadata_passthrough: { content_item_kinds: [{ invalid: true }] } }],
    ["metadata-invalid-turn", { internal_chat_message_metadata_passthrough: { turn_id: 1 } }],
    ["metadata-invalid-time", { internal_chat_message_metadata_passthrough: { create_time: "1" } }],
    ["metadata-null", { internal_chat_message_metadata_passthrough: null }],
    ["metadata-array", { internal_chat_message_metadata_passthrough: ["t", 1, ["user.text"]] }],
  ]) candidates.push([`inter-agent/${name}`, { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ ...communication, ...change }) }] }]);
  for (const [name, text] of [
    ["duplicate-author", '{"author":"/root/a","author":"/root/b","recipient":"/root/c","content":"x","trigger_turn":true}'],
    ["sequence", '[null,"/root/a","/root/b",[],"x",null,null,true]'],
    ["unknown-duplicate", '{"unknown":1,"unknown":2,"author":"/root/a","recipient":"/root/c","content":"x","trigger_turn":true}'],
    ["duplicate-metadata-kind", '{"author":"/root/a","recipient":"/root/c","content":"x","trigger_turn":true,"internal_chat_message_metadata_passthrough":{"content_item_kinds":null,"content_item_kinds":null}}'],
  ]) candidates.push([`inter-agent/${name}`, { type: "message", role: "assistant", content: [{ type: "output_text", text }] }]);
  candidates.push(["inter-agent/input-text", { type: "message", role: "assistant", content: [{ type: "input_text", text: JSON.stringify(communication) }] }]);
  candidates.push(["inter-agent/two-parts", { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(communication) }, { type: "output_text", text: "extra" }] }]);
  candidates.push(["agent-item", { type: "agent_message", author: "planner", recipient: "worker", content: [{ type: "input_text", text: "start" }] }]);
  candidates.push(["mixed-context", { type: "message", role: "user", content: [{ type: "input_text", text: "real request" }, { type: "input_text", text: "<skill>x</skill>" }] }]);
  candidates.push(["context-output-text", { type: "message", role: "user", content: [{ type: "output_text", text: "<skill>x</skill>" }] }]);
  candidates.push(["empty-user", { type: "message", role: "user", content: [] }]);
  candidates.push(["tool-with-user-role", { type: "function_call_output", call_id: "c", output: "done", role: "user" }]);
  return candidates.map(([name, candidate]) => ({ name: `boundary/${name}`, items: [user("original task"), oldReasoning, candidate, newReasoning, reply] }));
}
