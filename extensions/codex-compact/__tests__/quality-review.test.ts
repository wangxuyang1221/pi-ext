import { expect, test } from "vitest";
import * as review from "../../../scripts/codex-compact-quality-review.mjs";

test("builds repeatable human review packets with separate allocation keys and no arm or automated-grade metadata", () => {
  expect(typeof review.prepareBlindReview).toBe("function");
  const input = { seed: "private-allocation-seed", task: "Fix the issue without changing tests.", sources: { "source.py": "original" },
    candidates: ["old", "new", "cli", "reference"].map(arm => ({ arm, answer: "Done.", files: { "source.py": "fixed" }, toolEvents: [{ name: "read_file", arguments: { path: "source.py" }, status: "ok" }], grade: "passed", usage: { input: 999 }, encrypted_content: "never-export" })) };
  const { packet, allocation } = review.prepareBlindReview(input);
  expect(review.prepareBlindReview(input)).toEqual({ packet, allocation });
  expect(packet.humanReview).toBe("pending");
  expect(packet.origin).toBe("ai_generated_candidates");
  expect(packet.candidates).toHaveLength(4);
  expect(new Set(packet.candidates.map((row: any) => row.id)).size).toBe(4);
  expect(Object.values(allocation.candidates).sort()).toEqual(["cli", "new", "old", "reference"]);
  expect(packet.reviewers).toHaveLength(2);
  for (const reviewer of packet.reviewers) {
    expect([...reviewer.order].sort()).toEqual(packet.candidates.map((row: any) => row.id).sort());
    for (const form of reviewer.forms) expect(Object.values(form.ratings)).toEqual([null, null, null, null, null, null]);
  }
  for (const row of packet.candidates) expect(Object.keys(row).sort()).toEqual(["answer", "files", "id", "toolEvents"]);
  const serialized = JSON.stringify(packet);
  for (const key of ["arm", "grade", "usage", "encrypted_content", "seed", "workspacePath"]) expect(serialized).not.toContain(`"${key}"`);
  expect(serialized).not.toContain("never-export");
});

test("redacts condition-specific workspace roots in answers and tool errors while preserving diagnostic details", () => {
  const input = { seed: "private-allocation-seed", task: "task", sources: { "source.py": "original" },
    candidates: ["old", "new", "cli", "reference"].map(arm => ({ arm, workspacePath: `/private/${arm}/workspace`,
      answer: `Inspected /private/${arm}/workspace/source.py`, files: { "source.py": "fixed" },
      toolEvents: [{ name: "read_file", arguments: { path: "missing.py" }, status: "error", message: `ENOENT: realpath '/private/${arm}/workspace/missing.py'` }] })) };
  const { packet } = review.prepareBlindReview(input);
  for (const candidate of packet.candidates) {
    expect(candidate.answer).toBe("Inspected <workspace>/source.py");
    expect(candidate.toolEvents[0].message).toBe("ENOENT: realpath '<workspace>/missing.py'");
    expect(candidate.toolEvents[0].arguments.path).toBe("missing.py");
  }
  expect(JSON.stringify(packet)).not.toContain("/private/");
});
