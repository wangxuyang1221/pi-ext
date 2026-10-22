import { closeSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export type CodexCompactionConfig = {
	/** Optional Codex-style auto-compaction limit. */
	autoCompactTokenLimit?: number;
	autoCompactScope: "total" | "bodyAfterPrefix";
	/** Pi does not expose Codex's effective-window metadata. Defaults to 95. */
	effectiveContextWindowPercent?: number;
	/** Version sent to the official Codex model catalog. */
	metadataClientVersion?: string;
	/** Explicit contract for compaction outside an observed provider request. */
	manualProjection?: { hiddenTools: string[]; forcedPrompt?: string };
};

export const DEFAULT_METADATA_CLIENT_VERSION = "0.156.0";

export function isMetadataClientVersion(value: unknown): value is string {
	return typeof value === "string" && value.length <= 32
		&& /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value);
}

export type MetadataVersionStatus = {
	version: string;
	source: "default" | "global" | "project";
	sourcePath?: string;
	globalPath: string;
	warnings: string[];
};

function errorCategory(error: unknown): string {
	const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
	return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "unknown_error";
}

function readConfigWithWarning(path: string): { config: Partial<CodexCompactionConfig>; warning?: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (errorCategory(error) === "ENOENT") return { config: {} };
		return { config: {}, warning: `${path}: ${error instanceof SyntaxError ? "invalid_json" : errorCategory(error)}` };
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { config: {}, warning: `${path}: invalid_root` };
	const config = parseConfig(raw);
	return { config, ...("metadataClientVersion" in raw && !isMetadataClientVersion(raw.metadataClientVersion)
		? { warning: `${path}: invalid_metadataClientVersion` } : {}) };
}

export function getMetadataVersionStatus(cwd: string, trusted: boolean): MetadataVersionStatus {
	const globalPath = join(getAgentDir(), "pi-codex-compact.json");
	const global = readConfigWithWarning(globalPath);
	const projectPath = join(cwd, CONFIG_DIR_NAME, "pi-codex-compact.json");
	const project = trusted ? readConfigWithWarning(projectPath) : { config: {} as Partial<CodexCompactionConfig> };
	const warnings = [global.warning, "warning" in project ? project.warning : undefined].filter((value): value is string => value !== undefined);
	if (project.config.metadataClientVersion) return { version: project.config.metadataClientVersion, source: "project", sourcePath: projectPath, globalPath, warnings };
	if (global.config.metadataClientVersion) return { version: global.config.metadataClientVersion, source: "global", sourcePath: globalPath, globalPath, warnings };
	return { version: DEFAULT_METADATA_CLIENT_VERSION, source: "default", globalPath, warnings };
}

export class MetadataConfigError extends Error {
	constructor(readonly path: string, readonly category: string, readonly cleanupPath?: string) {
		super(`Metadata config ${category}: ${path}${cleanupPath ? `; temporary file remains: ${cleanupPath}` : ""}`);
	}
}

export function updateGlobalMetadataClientVersion(version: string | undefined): void {
	const path = join(getAgentDir(), "pi-codex-compact.json");
	if (version !== undefined && !isMetadataClientVersion(version)) throw new MetadataConfigError(path, "invalid_version");
	let original: Record<string, unknown> = {};
	let mode = 0o600;
	let exists = false;
	try {
		const stat = lstatSync(path);
		exists = true;
		if (!stat.isFile()) throw new MetadataConfigError(path, stat.isSymbolicLink() ? "symbolic_link" : "not_regular_file");
		mode = stat.mode & 0o777;
		let raw: unknown;
		try { raw = JSON.parse(readFileSync(path, "utf8")); }
		catch (error) { throw new MetadataConfigError(path, error instanceof SyntaxError ? "invalid_json" : errorCategory(error)); }
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new MetadataConfigError(path, "invalid_root");
		original = raw as Record<string, unknown>;
	} catch (error) {
		if (!(error instanceof MetadataConfigError) && errorCategory(error) !== "ENOENT") throw new MetadataConfigError(path, errorCategory(error));
		if (error instanceof MetadataConfigError) throw error;
	}
	if (version === undefined) {
		if (!exists || !Object.hasOwn(original, "metadataClientVersion")) return;
		delete original.metadataClientVersion;
	} else {
		if (original.metadataClientVersion === version) return;
		original.metadataClientVersion = version;
	}
	const tempPath = join(dirname(path), `.pi-codex-compact-${randomUUID()}.tmp`);
	let fd: number | undefined;
	let tempExists = false;
	try {
		if (!exists) mkdirSync(dirname(path), { recursive: true });
		fd = openSync(tempPath, "wx", 0o600);
		tempExists = true;
		fchmodSync(fd, mode);
		writeFileSync(fd, `${JSON.stringify(original, null, 2)}\n`);
		closeSync(fd);
		fd = undefined;
		renameSync(tempPath, path);
		tempExists = false;
	} catch (error) {
		if (fd !== undefined) try { closeSync(fd); } catch {}
		let cleanupPath: string | undefined;
		if (tempExists) try { unlinkSync(tempPath); } catch { cleanupPath = tempPath; }
		throw new MetadataConfigError(path, errorCategory(error), cleanupPath);
	}
}

const DEFAULT_CONFIG: CodexCompactionConfig = {
	autoCompactScope: "total",
	metadataClientVersion: DEFAULT_METADATA_CLIENT_VERSION,
};

export function parseConfig(input: unknown): Partial<CodexCompactionConfig> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
	const value = input as Record<string, unknown>;
	const manual = value.manualProjection as Record<string, unknown> | undefined;
	return {
		...(manual && typeof manual === "object" && !Array.isArray(manual) && Array.isArray(manual.hiddenTools)
			&& manual.hiddenTools.every(name => typeof name === "string" && name.length > 0)
			&& (manual.forcedPrompt === undefined || (typeof manual.forcedPrompt === "string" && manual.forcedPrompt.length > 0))
			? { manualProjection: { hiddenTools: [...new Set(manual.hiddenTools)] as string[], ...(manual.forcedPrompt === undefined ? {} : { forcedPrompt: manual.forcedPrompt as string }) } } : {}),
		...(isMetadataClientVersion(value.metadataClientVersion)
			? { metadataClientVersion: value.metadataClientVersion } : {}),
		...(typeof value.effectiveContextWindowPercent === "number" && Number.isFinite(value.effectiveContextWindowPercent)
			&& value.effectiveContextWindowPercent > 0 && value.effectiveContextWindowPercent <= 100
			? { effectiveContextWindowPercent: value.effectiveContextWindowPercent } : {}),
		...(typeof value.autoCompactTokenLimit === "number" && value.autoCompactTokenLimit > 0
			? { autoCompactTokenLimit: value.autoCompactTokenLimit }
			: {}),
		...(value.autoCompactScope === "total" || value.autoCompactScope === "bodyAfterPrefix"
			? { autoCompactScope: value.autoCompactScope }
			: {}),
	};
}

function readConfig(path: string): Partial<CodexCompactionConfig> {
	return readConfigWithWarning(path).config;
}

export function loadConfig(cwd: string, trusted: boolean): CodexCompactionConfig {
	const global = readConfig(join(getAgentDir(), "pi-codex-compact.json"));
	const project = trusted ? readConfig(join(cwd, CONFIG_DIR_NAME, "pi-codex-compact.json")) : {};
	return { ...DEFAULT_CONFIG, ...global, ...project };
}

/** Reserve Codex's default headroom without changing the raw-window auto threshold. */
export function effectiveContextWindow(config: CodexCompactionConfig, contextWindow: number): number {
	return Math.floor(contextWindow * (config.effectiveContextWindowPercent ?? 95) / 100);
}

/** Codex caps configured auto-compaction limits at 90% of the context window. */
export function autoCompactTokenLimit(config: CodexCompactionConfig, contextWindow: number): number {
	const codexLimit = Math.floor(contextWindow * 0.9);
	return config.autoCompactTokenLimit === undefined
		? codexLimit
		: Math.min(config.autoCompactTokenLimit, codexLimit);
}
