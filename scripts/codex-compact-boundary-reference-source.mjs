import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Extract unchanged matcher bodies, using empty enclosing types instead of the whole core runtime. */
export function boundaryReferenceSource(root) {
  const sources = {};
  const load = (path) => {
    const text = readFileSync(join(root, "codex-rs", path), "utf8");
    sources[path] = createHash("sha256").update(text).digest("hex");
    return text;
  };
  const fn = (text, name, indent = "") => {
    const match = new RegExp(`^${indent}(?:pub(?:\\(crate\\))? )?fn ${name}\\(`, "m").exec(text);
    if (!match) throw new Error(`Missing original function: ${name}`);
    const end = text.indexOf(`\n${indent}}`, match.index);
    if (end < 0) throw new Error(`Missing function end: ${name}`);
    return text.slice(match.index, end + indent.length + 2);
  };
  const fragment = load("context-fragments/src/fragment.rs");
  let code = `use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::items::parse_hook_prompt_fragment;
use codex_protocol::protocol::InterAgentCommunication;
trait ContextualUserFragment {
fn type_markers() -> (&'static str, &'static str) where Self: Sized;
${fn(fragment, "matches_text", "    ")}
}
${fn(fragment, "matches_marked_text")}
`;
  const types = [
    ["UserInstructions", "core/src/context/user_instructions.rs"],
    ["UserShellCommand", "core/src/context/user_shell_command.rs"],
    ["TurnAborted", "core/src/context/turn_aborted.rs"],
    ["SubagentNotification", "core/src/context/subagent_notification.rs"],
    ["RecommendedPluginsInstructions", "core/src/context/recommended_plugins_instructions.rs"],
    ["LegacyUnifiedExecProcessLimitWarning", "core/src/context/legacy_unified_exec_process_limit_warning.rs"],
    ["LegacyApplyPatchExecCommandWarning", "core/src/context/legacy_apply_patch_exec_command_warning.rs"],
    ["LegacyModelMismatchWarning", "core/src/context/legacy_model_mismatch_warning.rs"],
    ["AdditionalContextUserFragment", "context-fragments/src/additional_context.rs"],
    ["InternalModelContextFragment", "core/src/context/internal_model_context.rs"],
    ["EnvironmentsState", "core/src/context/world_state/environment.rs"],
    ["SkillInstructions", "ext/skills/src/fragments.rs"],
  ];
  for (const [name, path] of types) {
    const original = load(path);
    const section = original.slice(original.indexOf(`impl ContextualUserFragment for ${name}`));
    if (!section.startsWith("impl")) throw new Error(`Missing matcher implementation: ${name}`);
    code += `struct ${name};\nimpl ContextualUserFragment for ${name} {\n${fn(section, "type_markers", "    ")}\n`;
    if (/^    fn matches_text\(/m.test(section)) code += fn(section, "matches_text", "    ") + "\n";
    code += "}\n";
    if (["AdditionalContextUserFragment", "InternalModelContextFragment"].includes(name)) {
      code += [...original.matchAll(/^const [\s\S]*?;\n/gm)].map((match) => match[0]).join("");
    }
    if (name === "InternalModelContextFragment") code += fn(original, "matches_legacy_goal_context") + "\n" + fn(original, "is_valid_source") + "\n";
    if (name === "EnvironmentsState") code += fn(original, "environment_context_markers") + "\n";
  }
  code += `mod codex_skills_extension { pub fn is_skill_prompt_fragment(text: &str) -> bool { <super::SkillInstructions as super::ContextualUserFragment>::matches_text(text) } }\n`;
  const contextual = load("core/src/context/contextual_user_message.rs");
  const matchersStart = contextual.indexOf("const CONTEXTUAL_USER_FRAGMENT_MATCHERS");
  code += contextual.slice(matchersStart, contextual.indexOf("\n];", matchersStart) + 3) + "\n";
  code += fn(contextual, "is_standard_contextual_user_text") + "\n" + fn(contextual, "is_contextual_user_fragment") + "\n";
  code += fn(load("core/src/event_mapping.rs"), "is_contextual_user_message_content") + "\n";
  const history = load("core/src/context_manager/history.rs");
  code += fn(history, "is_user_turn_boundary") + "\n" + fn(history, "is_inter_agent_instruction_content") + "\n";
  return { code, sources, oldReasoningMethod: fn(history, "get_non_last_reasoning_items_tokens", "    ") };
}
