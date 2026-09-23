import { describe, expect, test } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createBranchProjectionSnapshot } from "../src/session-projection.js";

describe("Codex branch projection", () => {
	test.each(["overlap", "separate", "retain-none"])("matches Pi source messages with %s ordinary compaction", (mode) => {
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "system", content: "initial system", timestamp: 0 });
		const first = sm.appendMessage({ role: "user", content: "U1", timestamp: 1 });
		sm.appendCompaction("C1", first, 0);
		const second = sm.appendMessage({ role: "user", content: "U2", timestamp: 2 });
		sm.appendCompaction("C2", mode === "overlap" ? first : mode === "separate" ? second : null, 0);
		sm.appendMessage({ role: "user", content: "U3", timestamp: 3 });
		const branch = sm.getBranch();
		const before = structuredClone(branch);
		const projected = createBranchProjectionSnapshot(branch).piContext();
		expect(projected.map((entry) => [entry.sourceEntry.id, entry.messages])).toEqual(
			sm.buildSessionProjection().entries.map((entry) => [entry.sourceEntry.id, entry.messages]),
		);
		expect(branch).toEqual(before);
		expect(projected.every((entry) => entry.sourceEntry === branch[entry.sourceIndex])).toBe(true);
	});

	test("keeps later entries in a selected linear branch with a removed middle user", () => {
		const sm = SessionManager.inMemory(process.cwd());
		sm.appendMessage({ role: "user", content: "first", timestamp: 1 });
		const removed = sm.appendMessage({ role: "user", content: "failed", timestamp: 2 });
		const later = sm.appendMessage({ role: "user", content: "later", timestamp: 3 });
		const filtered = sm.getBranch().filter((entry) => entry.id !== removed);
		const original = structuredClone(filtered);
		const snapshot = createBranchProjectionSnapshot(filtered);
		expect(snapshot.piContext().map((entry) => entry.sourceEntry.id)).toContain(later);
		expect(JSON.stringify(snapshot.piContext().flatMap((entry) => entry.messages))).not.toContain("failed");
		expect(filtered).toEqual(original);
	});

	test.each([100, 1_000])("projects %i entries with bounded edit-target reads", (count) => {
		let reads = 0;
		const branch = Array.from({ length: count }, (_, index) => index % 2 === 0
			? { id: `user-${index}`, parentId: index === 0 ? null : `entry-${index - 1}`, type: "message", message: { role: "user", content: `U${index}`, timestamp: index } }
			: {
				id: `entry-${index}`, parentId: `user-${index - 1}`, type: "context_edit",
				get targetId() { reads++; return `user-${index - 1}`; },
				replacement: { content: `E${index}` },
			}) as never[];
		const snapshot = createBranchProjectionSnapshot(branch);
		const full = snapshot.fullHistory();
		expect(snapshot.fullHistory()).toBe(full);
		const pi = snapshot.piContext();
		expect(snapshot.piContext()).toBe(pi);
		expect(reads).toBeLessThanOrEqual(10 * count + 20);
		expect(JSON.stringify(full.at(-2)?.messages)).toContain(`E${count - 1}`);
	});

	test("grows edit-target work linearly from 100 to 1,000 entries", () => {
		const measure = (count: number) => {
			let reads = 0;
			const entries = Array.from({ length: count }, (_, index) => index % 2 === 0
				? { id: `u-${index}`, parentId: index === 0 ? null : `e-${index - 1}`, type: "message", message: { role: "user", content: `U${index}`, timestamp: index } }
				: { id: `e-${index}`, parentId: `u-${index - 1}`, type: "context_edit",
					get targetId() { reads++; return `u-${index - 1}`; }, replacement: { content: `E${index}` } }) as never[];
			const projection = createBranchProjectionSnapshot(entries);
			projection.fullHistory();
			projection.piContext();
			return reads;
		};
		const small = measure(100);
		const large = measure(1_000);
		expect(large).toBeLessThanOrEqual(small * 10 + 20);
	});
	test("keeps source identities while matching Pi across overlapping compactions", () => {
		const sm = SessionManager.inMemory(process.cwd());
		const first = sm.appendMessage({ role: "user", content: "first", timestamp: 1 });
		sm.appendCompaction("C1", first, 0);
		const second = sm.appendMessage({ role: "user", content: "second", timestamp: 2 });
		sm.appendCompaction("C2", first, 0);
		sm.appendContextEdit(second, { content: "edited second" });
		const branch = sm.getBranch();
		const before = structuredClone(branch);
		const snapshot = createBranchProjectionSnapshot(branch);
		const actual = snapshot.piContext();
		const expected = sm.buildSessionProjection().entries;
		expect(actual.map(({ sourceEntry, messages }) => ({ id: sourceEntry.id, messages }))).toEqual(
			expected.map(({ sourceEntry, messages }) => ({ id: sourceEntry.id, messages })),
		);
		expect(actual.map(({ sourceEntry, sourceIndex }) => branch[sourceIndex]?.id === sourceEntry.id)).toEqual(
			Array(actual.length).fill(true),
		);
		expect(JSON.stringify(actual.flatMap((entry) => entry.messages))).not.toContain("C1");
		expect(JSON.stringify(snapshot.fullHistory().flatMap((entry) => entry.messages))).toContain("edited second");
		expect(JSON.stringify(snapshot.fullHistory().flatMap((entry) => entry.messages))).not.toContain("C2");
		expect(branch).toEqual(before);
		expect(snapshot.piContext()).toBe(actual);
	});
});
