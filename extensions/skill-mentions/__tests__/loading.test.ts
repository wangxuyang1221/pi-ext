import { expect, it, vi } from "vitest";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { loadSnapshot } from "../src/loading.js";
import { encodeSnapshot } from "../src/protocol.js";

const commands = ["alpha", "beta"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: `/skills/${name}/SKILL.md` } })) as SlashCommandInfo[];

it("never recursively activates native slash expansions or plugin snapshots", async () => {
  const read = vi.fn(async () => "BODY\n $beta \n");
  const snapshot = await loadSnapshot("$alpha", commands, read);
  read.mockClear();
  for (const text of [encodeSnapshot(snapshot!), encodeSnapshot(snapshot!).replace('version="1"', 'version="2"'), '<skill name="alpha" location="/skills/alpha/SKILL.md">\n $beta \n</skill>\n\nUse $beta', '/skill:alpha $beta']) {
    expect(await loadSnapshot(text, commands, read)).toBeUndefined();
  }
  expect(read).not.toHaveBeenCalled();
});

it("loads a complete name before punctuation without changing the task", async () => {
  const read = vi.fn(async () => "BODY");
  const result = await loadSnapshot("$alpha!", commands, read);
  expect(result?.task).toBe("$alpha!");
  expect(result?.skills.map(skill => skill.name)).toEqual(["alpha"]);
  expect(read).toHaveBeenCalledExactlyOnceWith("/skills/alpha/SKILL.md");
});

it.each(["$al", "$unknown", "$", "用$alpha", "` $alpha `", "```\n$alpha\n```", "\\$alpha"])("keeps non-activating input unchanged: %s", async task => {
  const read = vi.fn(async () => "BODY");
  expect(await loadSnapshot(task, commands, read)).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it("silently omits unreadable skills while keeping other skills and all reference text", async () => {
  const read = vi.fn(async (path: string) => { if (path.includes("alpha")) throw new Error("EACCES"); return "BETA_BODY"; });
  const task = "$alpha $alpha $unknown $beta";
  const result = await loadSnapshot(task, commands, read);
  expect(result?.skills.map(skill => skill.name)).toEqual(["beta"]);
  expect(result?.task).toBe(task);
  expect(read).toHaveBeenCalledTimes(2);
  expect(await loadSnapshot("$alpha", commands, read)).toBeUndefined();
});

it("matches whole Unicode names and never truncates unknown names to inventory prefixes", async () => {
  const inventory = [...commands, ...["研究_𐐀-𝟠", "alpha-beta", "alpha_beta"].map(name => ({
    name: `skill:${name}`, source: "skill", sourceInfo: { path: `/skills/${name}/SKILL.md` },
  } as SlashCommandInfo))];
  const read = vi.fn(async () => "BODY");
  const task = "$alpha-long, $alpha_other! $研究_𐐀-𝟠。 $alpha-beta; $alpha_beta. $alpha.md $alpha.中文 $al,";
  const snapshot = await loadSnapshot(task, inventory, read);
  expect(snapshot?.task).toBe(task);
  expect(snapshot?.skills.map(skill => skill.name)).toEqual(["研究_𐐀-𝟠", "alpha-beta", "alpha_beta"]);
  expect(read).toHaveBeenCalledTimes(3);
});

it("deduplicates punctuated references in first order and silently skips repeated failed reads", async () => {
  const task = "$beta，继续 $alpha! $unknown. $alpha; $beta)";
  const read = vi.fn(async (path: string) => { if (path.includes("alpha")) throw new Error("EACCES"); return "BODY"; });
  const snapshot = await loadSnapshot(task, commands, read);
  expect(snapshot?.task).toBe(task);
  expect(snapshot?.skills.map(skill => skill.name)).toEqual(["beta"]);
  expect(read.mock.calls).toEqual([["/skills/beta/SKILL.md"], ["/skills/alpha/SKILL.md"]]);
  read.mockClear();
  expect(await loadSnapshot("$alpha! $unknown. $alpha,", commands, read)).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(1);
});

it.each([10, 100])("indexes %i skills once and bounds reads by distinct references", async count => {
  let nameReads = 0;
  const inventory = Array.from({ length: count }, (_, index) => ({
    get name() { nameReads++; return `skill:name-${index}`; }, source: "skill", sourceInfo: { path: `/skills/name-${index}/SKILL.md` },
  })) as SlashCommandInfo[];
  const read = vi.fn(async () => "BODY");
  const task = Array.from({ length: count * 10 }, (_, index) => `$name-${index % count}${index % 2 ? "," : "."}`).join(" ");
  expect((await loadSnapshot(task, inventory, read))?.skills).toHaveLength(count);
  expect(read).toHaveBeenCalledTimes(count);
  expect(nameReads).toBeLessThanOrEqual(count * 3);
});

it("loads distinct discovered skills once in first-reference order and preserves the task", async () => {
  const read = vi.fn(async (path: string) => `---\nname: fixture\ndescription: hidden\n---\nBODY ${path}\n $recursive \n`);
  const task = "用 $beta $alpha $beta $al $unknown";
  const result = await loadSnapshot(task, commands, read);
  expect(result?.task).toBe(task);
  expect(result?.skills.map(skill => skill.name)).toEqual(["beta", "alpha"]);
  expect(read.mock.calls).toEqual([["/skills/beta/SKILL.md"], ["/skills/alpha/SKILL.md"]]);
  expect(result?.skills[0]).toMatchObject({ location: "/skills/beta/SKILL.md", baseDir: "/skills/beta", body: expect.stringContaining("BODY /skills/beta/SKILL.md") });
  expect(result?.skills[0].body).not.toContain("description:");
});
