import { expect, test } from "vitest";
import windowReference from "./fixtures/codex-window-accounting.json" with { type: "json" };
import { approximateResponseItemTokens } from "../src/native-compaction.js";
import { WindowUsageAccounting } from "../src/usage-accounting.js";

const request = [{ role: "user", content: [{ type: "input_text", text: "x".repeat(40000) }] }];
const reply = { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] };
const message = { role: "assistant", provider: "openai-codex", api: "openai-codex-responses", model: "gpt", stopReason: "stop", usage: { input: 80, output: 20, cacheRead: 30, cacheWrite: 0, totalTokens: 130 } };

test("uses server total once and estimates only items following the latest model output", () => {
	const accounting = new WindowUsageAccounting();
	accounting.observeRequest("prefix", request);
	accounting.observeResponse(message);
	const tail = { type: "function_call_output", call_id: "call", output: "new tool output" };
	expect(accounting.estimate("prefix", [...request, reply, tail], message, () => 17)).toBe(147);
});

test("adds only encrypted reasoning before the latest user boundary when server inclusion is unknown", () => {
	const accounting = new WindowUsageAccounting();
	const old = { type: "reasoning", encrypted_content: "x".repeat(1000) };
	const sent = [old, ...request];
	accounting.observeRequest("prefix", sent);
	accounting.observeResponse(message);
	const history = [...sent, { ...old, encrypted_content: "y".repeat(2000) }, reply];
	expect(accounting.estimate("prefix", history, message, approximateResponseItemTokens)).toBe(155);
});

for (const [name, mutate] of [
	["changed instructions or tools", (a: WindowUsageAccounting) => a.estimate("changed", [...request, reply], message, approximateResponseItemTokens)],
	["changed covered history", (a: WindowUsageAccounting) => a.estimate("prefix", [{ role: "user", content: "different" }, reply], message, approximateResponseItemTokens)],
	["replaced checkpoint", (a: WindowUsageAccounting) => a.estimate("prefix", [{ type: "compaction", encrypted_content: "new" }, reply], message, approximateResponseItemTokens)],
	["different latest assistant", (a: WindowUsageAccounting) => a.estimate("prefix", [...request, reply], { ...message, model: "other" }, approximateResponseItemTokens)],
	["missing output boundary", (a: WindowUsageAccounting) => a.estimate("prefix", [...request, { role: "user", content: "next" }], message, approximateResponseItemTokens)],
] as const) {
	test(`falls back locally for ${name}`, () => {
		const accounting = new WindowUsageAccounting();
		accounting.observeRequest("prefix", request);
		accounting.observeResponse(message);
		expect(mutate(accounting)).toBeUndefined();
	});
}

for (const stopReason of ["error", "aborted", "pending"]) {
	test(`does not trust usage from ${stopReason} responses`, () => {
		const accounting = new WindowUsageAccounting();
		accounting.observeRequest("prefix", request);
		accounting.observeResponse({ ...message, stopReason });
		expect(accounting.estimate("prefix", [...request, reply], { ...message, stopReason }, approximateResponseItemTokens)).toBeUndefined();
	});
}

for (const totalTokens of [0, -1, NaN, Infinity, 1.5, undefined]) {
	test(`rejects invalid total usage ${totalTokens}`, () => {
		const accounting = new WindowUsageAccounting();
		accounting.observeRequest("prefix", request);
		const invalid = { ...message, usage: { ...message.usage, totalTokens } };
		accounting.observeResponse(invalid);
		expect(accounting.estimate("prefix", [...request, reply], invalid, approximateResponseItemTokens)).toBeUndefined();
	});
}

test("requires a new successful response after submitting another request", () => {
	const accounting = new WindowUsageAccounting();
	accounting.observeRequest("prefix", request);
	accounting.observeResponse(message);
	accounting.observeRequest("prefix", [...request, reply]);
	expect(accounting.estimate("prefix", [...request, reply, reply], message, approximateResponseItemTokens)).toBeUndefined();
});

test.each(["tool_search_call", "web_search_call", "image_generation_call", "local_shell_call", "compaction", "context_compaction"])("recognizes Codex model output boundary %s", (type) => {
	const accounting = new WindowUsageAccounting();
	accounting.observeRequest("prefix", request);
	accounting.observeResponse(message);
	expect(accounting.estimate("prefix", [...request, { type }], message, approximateResponseItemTokens)).toBe(130);
});

test("matches genuine Codex CLI active usage on the frozen 90 percent snapshot", () => {
	const accounting = new WindowUsageAccounting();
	const oldReasoning = windowReference.oldReasoningEncodedLengths.map((length) => ({ type: "reasoning", encrypted_content: "x".repeat(length) }));
	const sent = [...oldReasoning, ...request];
	const response = { ...message, usage: { totalTokens: windowReference.serverTotal } };
	accounting.observeRequest("prefix", sent);
	accounting.observeResponse(response);
	expect(accounting.estimate("prefix", [...sent, reply], response, approximateResponseItemTokens)).toBe(windowReference.activeTokens);
});

test("does not turn contextual user fragments into a new reasoning boundary", () => {
	const accounting = new WindowUsageAccounting();
	const reasoning = { type: "reasoning", encrypted_content: "x".repeat(1000) };
	const contextual = { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd=/repo</environment_context>" }] };
	const sent = [...request, reasoning, contextual];
	accounting.observeRequest("prefix", sent);
	accounting.observeResponse(message);
	expect(accounting.estimate("prefix", [...sent, reply], message, approximateResponseItemTokens)).toBe(130);
});

test("stores immutable coverage and accepts JSON key order differences", () => {
	const accounting = new WindowUsageAccounting();
	const sent = structuredClone(request);
	accounting.observeRequest("prefix", sent);
	accounting.observeResponse(message);
	expect(accounting.estimate("prefix", [{ content: sent[0]!.content, role: "user" }, reply], message, approximateResponseItemTokens)).toBe(130);
	sent[0]!.content[0]!.text = "mutated";
	expect(accounting.estimate("prefix", [...sent, reply], message, approximateResponseItemTokens)).toBeUndefined();
});

