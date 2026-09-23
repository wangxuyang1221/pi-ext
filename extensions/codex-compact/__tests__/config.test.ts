import { describe, expect, test, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { autoCompactTokenLimit, DEFAULT_METADATA_CLIENT_VERSION, getMetadataVersionStatus, loadConfig, parseConfig, updateGlobalMetadataClientVersion } from "../src/config.js";

const fsFaults = vi.hoisted(() => ({ rename: false, write: false, cleanup: false, readFailure: "", reads: [] as string[], renames: 0 }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: ((path: Parameters<typeof actual.readFileSync>[0], ...rest: any[]) => {
			if (typeof path === "string") fsFaults.reads.push(path);
			if (path === fsFaults.readFailure) throw Object.assign(new Error("secret read failure"), { code: "EACCES" });
			return (actual.readFileSync as any)(path, ...rest);
		}) as typeof actual.readFileSync,
		writeFileSync: ((path: Parameters<typeof actual.writeFileSync>[0], ...rest: any[]) => {
			if (fsFaults.write && typeof path === "number") throw Object.assign(new Error("secret write failure"), { code: "EIO" });
			return (actual.writeFileSync as any)(path, ...rest);
		}) as typeof actual.writeFileSync,
		renameSync: ((...args: Parameters<typeof actual.renameSync>) => {
			fsFaults.renames++;
			if (fsFaults.rename) throw Object.assign(new Error("secret rename failure"), { code: "EIO" });
			return actual.renameSync(...args);
		}) as typeof actual.renameSync,
		unlinkSync: ((path: Parameters<typeof actual.unlinkSync>[0]) => {
			if (fsFaults.cleanup && String(path).endsWith(".tmp")) throw Object.assign(new Error("secret cleanup failure"), { code: "EIO" });
			return actual.unlinkSync(path);
		}) as typeof actual.unlinkSync,
	};
});

describe("Codex compaction config", () => {
	test("reports version provenance and preserves unrelated fields during atomic updates", () => {
		mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
		const root = mkdtempSync(join(process.cwd(), ".tmp", "metadata-update-"));
		const agent = join(root, "agent");
		const project = join(root, "project");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agent;
		const globalPath = join(agent, "pi-codex-compact.json");
		const projectPath = join(project, ".pi", "pi-codex-compact.json");
		try {
			expect(getMetadataVersionStatus(project, false)).toMatchObject({ version: "0.156.0", source: "default", globalPath });
			updateGlobalMetadataClientVersion(undefined);
			expect(existsSync(agent)).toBe(false);
			updateGlobalMetadataClientVersion("0.157.0");
			expect(statSync(globalPath).mode & 0o777).toBe(0o600);
			const original = { metadataClientVersion: "0.157.0", autoCompactScope: "total",
				autoCompactTokenLimit: 1000, effectiveContextWindowPercent: 95, extra: { secret: "kept" } };
			writeFileSync(globalPath, JSON.stringify(original));
			chmodSync(globalPath, 0o640);
			const bytes = readFileSync(globalPath, "utf8");
			const priorRenames = fsFaults.renames;
			updateGlobalMetadataClientVersion("0.157.0");
			expect(readFileSync(globalPath, "utf8")).toBe(bytes);
			expect(fsFaults.renames).toBe(priorRenames);
			updateGlobalMetadataClientVersion("0.159.0");
			expect(fsFaults.renames).toBe(priorRenames + 1);
			expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({ ...original, metadataClientVersion: "0.159.0" });
			expect(statSync(globalPath).mode & 0o777).toBe(0o640);
			mkdirSync(join(project, ".pi"), { recursive: true });
			writeFileSync(projectPath, JSON.stringify({ metadataClientVersion: "0.158.0" }));
			expect(getMetadataVersionStatus(project, false)).toMatchObject({ version: "0.159.0", source: "global", sourcePath: globalPath });
			expect(getMetadataVersionStatus(project, true)).toMatchObject({ version: "0.158.0", source: "project", sourcePath: projectPath });
			updateGlobalMetadataClientVersion(undefined);
			expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({ autoCompactScope: "total",
				autoCompactTokenLimit: 1000, effectiveContextWindowPercent: 95, extra: { secret: "kept" } });
			expect(getMetadataVersionStatus(project, false).source).toBe("default");
			expect(getMetadataVersionStatus(project, true).source).toBe("project");
			const after = readFileSync(globalPath, "utf8");
			const resetRenames = fsFaults.renames;
			updateGlobalMetadataClientVersion(undefined);
			expect(readFileSync(globalPath, "utf8")).toBe(after);
			expect(fsFaults.renames).toBe(resetRenames);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("rejects malformed and unsafe global targets without replacing them", () => {
		mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
		const root = mkdtempSync(join(process.cwd(), ".tmp", "metadata-invalid-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = root;
		const path = join(root, "pi-codex-compact.json");
		try {
			for (const contents of ["{secret", "[]", "null", "42"]) {
				writeFileSync(path, contents);
				expect(() => updateGlobalMetadataClientVersion("0.157.0")).toThrow();
				expect(readFileSync(path, "utf8")).toBe(contents);
			}
			writeFileSync(path, '{"metadataClientVersion":"latest","extra":true}');
			updateGlobalMetadataClientVersion("0.157.0");
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ metadataClientVersion: "0.157.0", extra: true });
			rmSync(path);
			mkdirSync(path);
			expect(() => updateGlobalMetadataClientVersion("0.157.0")).toThrow(/not_regular_file/);
			rmSync(path, { recursive: true });
			writeFileSync(join(root, "other"), "original");
			symlinkSync(join(root, "other"), path);
			expect(() => updateGlobalMetadataClientVersion("0.157.0")).toThrow();
			expect(readFileSync(join(root, "other"), "utf8")).toBe("original");
			expect(() => updateGlobalMetadataClientVersion("latest")).toThrow();
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reads each allowed file once and leaves the original intact after replacement failures", () => {
		mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
		const root = mkdtempSync(join(process.cwd(), ".tmp", "metadata-fault-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = root;
		const path = join(root, "pi-codex-compact.json");
		const project = join(root, "project");
		const projectPath = join(project, ".pi", "pi-codex-compact.json");
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(path, '{"metadataClientVersion":"0.156.0","secret":"preserve"}');
		writeFileSync(projectPath, '{"metadataClientVersion":"0.158.0"}');
		try {
			fsFaults.reads = [];
			loadConfig(project, false);
			expect(fsFaults.reads).toEqual([path]);
			fsFaults.reads = [];
			expect(getMetadataVersionStatus(project, true).source).toBe("project");
			expect(fsFaults.reads).toEqual([path, projectPath]);
			fsFaults.reads = [];
			expect(getMetadataVersionStatus(project, false).source).toBe("global");
			expect(fsFaults.reads).toEqual([path]);
			fsFaults.readFailure = projectPath;
			const degraded = getMetadataVersionStatus(project, true);
			expect(degraded).toMatchObject({ version: "0.156.0", source: "global" });
			expect(degraded.warnings).toEqual([`${projectPath}: EACCES`]);
			fsFaults.readFailure = "";
			fsFaults.readFailure = path;
			expect(() => updateGlobalMetadataClientVersion("0.157.0")).toThrow(/EACCES/);
			fsFaults.readFailure = "";
			writeFileSync(projectPath, '{"metadataClientVersion":"latest"}');
			expect(getMetadataVersionStatus(project, true).warnings).toEqual([`${projectPath}: invalid_metadataClientVersion`]);
			writeFileSync(projectPath, "{bad");
			expect(getMetadataVersionStatus(project, true).warnings).toEqual([`${projectPath}: invalid_json`]);
			for (const kind of ["write", "rename"] as const) {
				fsFaults[kind] = true;
				expect(() => updateGlobalMetadataClientVersion("0.157.0")).toThrow(/EIO/);
				fsFaults[kind] = false;
				expect(readFileSync(path, "utf8")).toBe('{"metadataClientVersion":"0.156.0","secret":"preserve"}');
				expect(readdirSync(root).filter(name => name.endsWith(".tmp"))).toEqual([]);
			}
			fsFaults.rename = true;
			fsFaults.cleanup = true;
			expect(() => updateGlobalMetadataClientVersion("0.157.0")).toThrow(/temporary file remains/);
		} finally {
			fsFaults.rename = fsFaults.write = fsFaults.cleanup = false;
			fsFaults.readFailure = "";
			fsFaults.reads = [];
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(root, { recursive: true, force: true });
		}
	});
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
