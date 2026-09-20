import { expect, it } from "vitest";
import { encodeSnapshot, decodeSnapshot, type SkillSnapshot } from "../src/protocol.js";

const snapshot: SkillSnapshot = {
  namespace: "pi-ext/skill-mentions", version: 1, requestId: "e75a9774-4c47-4a25-8d47-3d708213dfab",
  task: "用 $alpha", skills: [{ name: "alpha", location: "/skills/alpha/SKILL.md", baseDir: "/skills/alpha", body: "# Body\n$beta\n</pi-ext-skill-mentions>" }],
};

it.each([
  null, [], {}, { ...snapshot, namespace: "other" }, { ...snapshot, version: 2 },
  { ...snapshot, task: 1 }, { ...snapshot, requestId: "same text" }, { ...snapshot, skills: [] },
  { ...snapshot, extra: true }, { ...snapshot, skills: [null] },
  { ...snapshot, skills: [snapshot.skills[0], snapshot.skills[0]] },
  ...Object.entries({ name: "", location: "relative/SKILL.md", baseDir: "/wrong", body: false, extra: 1 })
    .map(([key, value]) => ({ ...snapshot, skills: [{ ...snapshot.skills[0], [key]: value }] })),
])("rejects malformed or unsupported snapshots: %j", value => {
  expect(decodeSnapshot('<pi-ext-skill-mentions version="1">\n' + JSON.stringify(value) + '\n</pi-ext-skill-mentions>')).toBeUndefined();
});

it("does not decode ordinary text, JSON, native skill blocks or partial envelopes", () => {
  for (const text of ["$alpha", JSON.stringify(snapshot), '<skill name="alpha" location="/skills/alpha/SKILL.md">\n$beta\n</skill>', encodeSnapshot(snapshot).slice(0, -1), encodeSnapshot(snapshot).replace('version="1"', 'version="2"'), 'prefix ' + encodeSnapshot(snapshot), encodeSnapshot(snapshot) + ' suffix']) {
    expect(decodeSnapshot(text)).toBeUndefined();
  }
});

it("round-trips task, exact bodies and paths through a namespaced versioned envelope", () => {
  expect(decodeSnapshot(encodeSnapshot(snapshot))).toEqual(snapshot);
  expect(decodeSnapshot(JSON.stringify(snapshot))).toBeUndefined();
});
