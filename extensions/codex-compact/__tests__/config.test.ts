import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { autoCompactTokenLimit, DEFAULT_METADATA_CLIENT_VERSION, loadConfig, parseConfig } from "../src/config.js";

describe("Codex compaction config", () => {
	test("accepts only stable bounded metadata client versions", () => {
		expect(DEFAULT_METADATA_CLIENT_VERSION).toBe("0.156.0");
		expect(parseConfig({ metadataClientVersion: "1.2.3" })).toEqual({ metadataClientVersion: "1.2.3" });
		for (const value of [12, null, "", " 0.156.0", "0.156.0 ", "v0.156.0", "0.156.0-beta", "0.156.0?x=y", "00.1.2", "0.01.2", "1.123456789012345678901234567890.2"]) {
			expect(parseConfig({ metadataClientVersion: value })).toEqual({});
		}
	});

	test("merges global and trusted project versions without reading an untrusted project", () => {
		mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
		const root = mkdtempSync(join(process.cwd(), ".tmp", "metadata-config-"));
		const agent = join(root, "agent");
		const project = join(root, "project");
		mkdirSync(agent);
		mkdirSync(join(project, ".pi"), { recursive: true });
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agent;
		const globalPath = join(agent, "pi-codex-compact.json");
		const projectPath = join(project, ".pi", "pi-codex-compact.json");
		try {
			expect(loadConfig(project, false).metadataClientVersion).toBe("0.156.0");
			writeFileSync(globalPath, JSON.stringify({ metadataClientVersion: "0.157.0" }));
			writeFileSync(projectPath, JSON.stringify({ metadataClientVersion: "0.158.0" }));
			expect(loadConfig(project, false).metadataClientVersion).toBe("0.157.0");
			expect(loadConfig(project, true).metadataClientVersion).toBe("0.158.0");
			writeFileSync(projectPath, JSON.stringify({ metadataClientVersion: "bad" }));
			expect(loadConfig(project, true).metadataClientVersion).toBe("0.157.0");
			writeFileSync(globalPath, JSON.stringify({ metadataClientVersion: "bad" }));
			expect(loadConfig(project, true).metadataClientVersion).toBe("0.156.0");
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(root, { recursive: true, force: true });
		}
	});
	test("accepts a bounded effective-window percentage override", () => {
		expect(parseConfig({ effectiveContextWindowPercent: 95 })).toEqual({ effectiveContextWindowPercent: 95 });
		for (const value of [0, -1, 101, Infinity, NaN, "95"]) {
			expect(parseConfig({ effectiveContextWindowPercent: value })).toEqual({});
		}
	});

	test("parses supported settings", () => {
		expect(parseConfig({
			autoCompactTokenLimit: 128_000,
			autoCompactScope: "bodyAfterPrefix",
		})).toEqual({
			autoCompactTokenLimit: 128_000,
			autoCompactScope: "bodyAfterPrefix",
		});
	});

	test("clamps a configured limit to Codex's 90 percent cap", () => {
		expect(autoCompactTokenLimit({ autoCompactTokenLimit: 200, autoCompactScope: "total" }, 100)).toBe(90);
		expect(autoCompactTokenLimit({ autoCompactTokenLimit: 80, autoCompactScope: "total" }, 100)).toBe(80);
	});
});
