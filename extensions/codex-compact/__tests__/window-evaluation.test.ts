import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// @ts-expect-error The evaluation helper is an executable JavaScript fixture.
import { classifyWindowEvidence, copySessionSnapshot } from "../../../scripts/codex-compact-window-evidence.mjs";

test("copies rollout snapshots without SQLite indexes pointing at the source home", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "window-snapshot-"));
	try {
		const home = path.join(root, "home");
		const snapshot = path.join(root, "snapshot");
		const destination = path.join(root, "clone");
		fs.mkdirSync(home); fs.mkdirSync(snapshot);
		fs.writeFileSync(path.join(home, "auth.json"), "test-only");
		fs.writeFileSync(path.join(home, "state_5.sqlite"), "absolute-source-path-index");
		fs.writeFileSync(path.join(snapshot, "rollout.jsonl"), "frozen-history");
		copySessionSnapshot(home, snapshot, destination);
		expect(fs.existsSync(path.join(destination, "state_5.sqlite"))).toBe(false);
		expect(fs.readFileSync(path.join(destination, "sessions/rollout.jsonl"), "utf8")).toBe("frozen-history");
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("requires measured usage at 90% but below the separate hard cap", () => {
	expect(classifyWindowEvidence(272000, 244800)).toEqual({ autoLimit: 244800, effectiveLimit: 258400, thresholdOnly: true });
	expect(classifyWindowEvidence(272000, 244799).thresholdOnly).toBe(false);
	expect(classifyWindowEvidence(272000, 258400).thresholdOnly).toBe(false);
	expect(classifyWindowEvidence(272000, undefined).thresholdOnly).toBe(false);
});
