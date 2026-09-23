import { expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerMetadataCommand } from "../src/metadata-command.js";

test("registers a read-only status and saves or resets the global version", async () => {
	mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
	const root = mkdtempSync(join(process.cwd(), ".tmp", "metadata-command-"));
	const agent = join(root, "agent");
	const project = join(root, "project");
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	const globalPath = join(agent, "pi-codex-compact.json");
	const projectPath = join(project, ".pi", "pi-codex-compact.json");
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const notify = vi.fn();
	const ctx = { cwd: project, isProjectTrusted: () => true, hasUI: true, ui: { notify } };
	try {
		registerMetadataCommand({ registerCommand: (name, options) => commands.set(name, options) } as never);
		const handler = commands.get("codex-metadata")?.handler;
		expect(handler).toBeDefined();
		await handler!("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("0.156.0"), "info");
		expect(existsSync(agent)).toBe(false);
		const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
		const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await handler!("", { ...ctx, hasUI: false });
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Effective metadata client version: 0.156.0"));
			expect(stdout).not.toHaveBeenCalled();
		} finally { stderr.mockRestore(); stdout.mockRestore(); }
		await handler!("version 0.157.0", ctx);
		expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({ metadataClientVersion: "0.157.0" });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("0.157.0"), "info");
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(projectPath, JSON.stringify({ metadataClientVersion: "0.158.0" }));
		await handler!("  version\t0.159.0  ", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Project override remains active: 0.158.0"), "info");
		expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({ metadataClientVersion: "0.159.0" });
		await handler!("reset", ctx);
		expect(readFileSync(projectPath, "utf8")).toContain("0.158.0");
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Project override remains active: 0.158.0"), "info");
		const bytes = readFileSync(globalPath, "utf8");
		await handler!("reset", ctx);
		expect(readFileSync(globalPath, "utf8")).toBe(bytes);
		for (const args of ["version", "version latest", "version 0.157.0-beta", "version 0.157.0 extra", "reset now", "--project"]) {
			await handler!(args, ctx);
			expect(readFileSync(globalPath, "utf8")).toBe(bytes);
		}
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage:"), "error");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("reports safe errors and keeps successful writes when feedback channels fail", async () => {
	mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
	const root = mkdtempSync(join(process.cwd(), ".tmp", "metadata-feedback-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const path = join(root, "pi-codex-compact.json");
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	registerMetadataCommand({ registerCommand: (name, options) => commands.set(name, options) } as never);
	const handler = commands.get("codex-metadata")!.handler;
	const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		writeFileSync(path, '{"secret":"DO_NOT_PRINT",');
		const notify = vi.fn();
		await handler("version 0.157.0", { cwd: root, isProjectTrusted: () => false, hasUI: true, ui: { notify } });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("invalid_json"), "error");
		expect(JSON.stringify(notify.mock.calls)).not.toContain("DO_NOT_PRINT");
		expect(readFileSync(path, "utf8")).toContain("DO_NOT_PRINT");
		rmSync(path);
		const failingNotify = vi.fn(() => { throw new Error("UI failed"); });
		await handler("version 0.157.0", { cwd: root, isProjectTrusted: () => false, hasUI: true, ui: { notify: failingNotify } });
		expect(readFileSync(path, "utf8")).toContain("0.157.0");
		expect(stderr).toHaveBeenCalledTimes(1);
		expect(stderr.mock.calls[0]?.[0]).toContain("Saved metadata client version 0.157.0");
		stderr.mockImplementation(() => { throw new Error("stderr failed"); });
		await expect(handler("version 0.158.0", { cwd: root, isProjectTrusted: () => false, hasUI: true, ui: { notify: failingNotify } })).resolves.toBeUndefined();
		expect(readFileSync(path, "utf8")).toContain("0.158.0");
	} finally {
		stderr.mockRestore();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});
