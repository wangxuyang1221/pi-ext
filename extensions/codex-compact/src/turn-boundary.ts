// Adapted from Codex 0.154.0 contextual-user and history boundary rules.
import type { ResponseItem } from "./native-compaction.js";
import { isHookPrompt, isInterAgentCommunication } from "./media-decoder.js";

const markers = [
	["# AGENTS.md instructions", "</INSTRUCTIONS>"],
	["<environment_context>", "</environment_context>"],
	["<skill>", "</skill>"],
	["<user_shell_command>", "</user_shell_command>"],
	["<turn_aborted>", "</turn_aborted>"],
	["<subagent_notification>", "</subagent_notification>"],
	["<recommended_plugins>", "</recommended_plugins>"],
] as const;

function rustTrim(text: string): string {
	const whitespace = /\p{White_Space}/u;
	let start = 0;
	let end = text.length;
	while (start < end && whitespace.test(text[start]!)) start++;
	while (end > start && whitespace.test(text[end - 1]!)) end--;
	return text.slice(start, end);
}

function asciiLower(text: string): string {
	return text.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

function marked(text: string, start: string, end: string): boolean {
	return asciiLower(text.slice(0, start.length)) === asciiLower(start)
		&& asciiLower(text.slice(-end.length)) === asciiLower(end);
}

function contextualText(text: string): boolean {
	const trimmed = rustTrim(text);
	if (markers.some(([start, end]) => marked(trimmed, start, end))) return true;
	if (trimmed.startsWith("<external_")) {
		const rest = trimmed.slice("<external_".length);
		const split = rest.indexOf(">");
		if (split >= 0 && rest.slice(split + 1).endsWith(`</external_${rest.slice(0, split)}>`)) return true;
	}
	if (trimmed.startsWith("<goal_context>") && trimmed.endsWith("</goal_context>")) return true;
	const internal = /^<codex_internal_context source="([a-z][a-z0-9_]*)">/.exec(trimmed);
	if (internal && trimmed.slice(internal[0].length).endsWith("</codex_internal_context>")) return true;
	if (trimmed.startsWith("Warning: The maximum number of unified exec processes you can keep open is")
		|| trimmed.startsWith("Warning: Your account was flagged for potentially high-risk cyber activity")
		|| (trimmed.startsWith("Warning: apply_patch was requested via ") && trimmed.endsWith("Use the apply_patch tool instead of exec_command."))) return true;
	// Plain text cannot deserialize as an XML struct. Avoid loading WASM and
	// copying long ordinary user turns merely to discover this in the parser.
	return (trimmed.startsWith("<") || trimmed.startsWith("\ufeff")) && isHookPrompt(text);
}

/** Identify a new user turn rather than every user-role contextual fragment. */
export function isUserTurnBoundary(item: ResponseItem): boolean {
	if (item.type === "agent_message") return true;
	// Pi also emits shorthand messages without an explicit type.
	if (item.type !== undefined && item.type !== "message") return false;
	if (item.role === "user") {
		return !Array.isArray(item.content) || !item.content.some((part) => part?.type === "input_text"
			&& typeof part.text === "string" && contextualText(part.text));
	}
	if (item.role !== "assistant" || !Array.isArray(item.content) || item.content.length !== 1) return false;
	const part = item.content[0];
	if (!part || !["input_text", "output_text"].includes(part.type) || typeof part.text !== "string") return false;
	const trimmed = rustTrim(part.text);
	return (trimmed.startsWith("{") || trimmed.startsWith("[")) && isInterAgentCommunication(part.text);
}
