import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export type CodexCompactionConfig = {
	/** Optional Codex-style auto-compaction limit. */
	autoCompactTokenLimit?: number;
	autoCompactScope: "total" | "bodyAfterPrefix";
};

const DEFAULT_CONFIG: CodexCompactionConfig = {
	autoCompactScope: "total",
};

export function parseConfig(input: unknown): Partial<CodexCompactionConfig> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
	const value = input as Record<string, unknown>;
	return {
		...(typeof value.autoCompactTokenLimit === "number" && value.autoCompactTokenLimit > 0
			? { autoCompactTokenLimit: value.autoCompactTokenLimit }
			: {}),
		...(value.autoCompactScope === "total" || value.autoCompactScope === "bodyAfterPrefix"
			? { autoCompactScope: value.autoCompactScope }
			: {}),
	};
}

function readConfig(path: string): Partial<CodexCompactionConfig> {
	try {
		return parseConfig(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return {};
	}
}

export function loadConfig(cwd: string, trusted: boolean): CodexCompactionConfig {
	const global = readConfig(join(getAgentDir(), "pi-codex-compact.json"));
	const project = trusted ? readConfig(join(cwd, CONFIG_DIR_NAME, "pi-codex-compact.json")) : {};
	return { ...DEFAULT_CONFIG, ...global, ...project };
}

/** Codex caps configured auto-compaction limits at 90% of the context window. */
export function autoCompactTokenLimit(config: CodexCompactionConfig, contextWindow: number): number {
	const codexLimit = Math.floor(contextWindow * 0.9);
	return config.autoCompactTokenLimit === undefined
		? codexLimit
		: Math.min(config.autoCompactTokenLimit, codexLimit);
}
