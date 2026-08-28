import { describe, expect, test } from "vitest";
import { compactionHash } from "../src/capabilities.js";

const model = (provider: string, api = "openai-codex-responses", id = "gpt-5.5") => ({ provider, api, id }) as never;

describe("Codex compaction hash snapshot", () => {
	test("uses only the frozen Codex hash snapshot", () => {
		expect(compactionHash(model("openai-codex", "openai-codex-responses", "gpt-5.6-luna"))).toBe("3000");
		expect(compactionHash(model("openai-codex", "openai-codex-responses", "gpt-5.2"))).toBeUndefined();
		expect(compactionHash({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", compHash: "runtime" } as never)).toBe("2911");
		expect(compactionHash({ provider: "anthropic", api: "openai-codex-responses", id: "gpt-5.5" } as never)).toBeUndefined();
	});
});
