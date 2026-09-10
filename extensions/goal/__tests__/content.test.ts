import { mkdtemp, rm, readFile, writeFile, readdir, symlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { GoalContent } from "../src/content.js";

const imageName = "pi-clipboard-12345678-1234-4123-8123-123456789abc.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGPk0Y1iIAUwkaSaYVQDcYCJSHVwMKqBGEByKAEA9NsAs1GX4RQAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(resolve(".goal-content-test-"));
  roots.push(root);
  return { root, content: new GoalContent(resolve(root, "content"), root) };
}

it("copies only selected native paste images and keeps them readable without the source", async () => {
  const { root, content } = await fixture();
  const source = resolve(root, imageName);
  await writeFile(source, png);
  const text = `Inspect ${source} and ${source}`;
  const untouched = await content.prepare(text, []);
  expect(untouched.objective).toBe(text);
  expect(untouched.content).toBeUndefined();
  const saved = await content.prepare(text, [source]);
  expect(saved.content).toBeDefined();
  await rm(source);
  const expanded = await content.expand(saved);
  expect(expanded).not.toContain(source);
  const images = await content.attachments(saved);
  expect(images).toHaveLength(1);
  expect(await readFile(images[0]!)).toEqual(png);
  expect(expanded).toBe(`Inspect ${images[0]} and ${images[0]}`);
});

it("rejects arbitrary selected paths, traversal, source symlinks and destination symlinks", async () => {
  const { root, content } = await fixture();
  const arbitrary = resolve(root, "private.png");
  await writeFile(arbitrary, png);
  await expect(content.prepare(arbitrary, [arbitrary])).rejects.toThrow(/paste|path/i);
  const source = resolve(root, imageName);
  await symlink(arbitrary, source);
  await expect(content.prepare(source, [source])).rejects.toThrow(/symbolic|symlink/i);
  await rm(source);
  await writeFile(source, png);
  const traversal = `${root}/../${root.split("/").at(-1)}/${imageName}`;
  await expect(content.prepare(traversal, [traversal])).rejects.toThrow(/path|paste/i);
  const target = resolve(root, "outside");
  await mkdir(target);
  await symlink(target, content.root);
  await expect(content.prepare("x".repeat(4001), [])).rejects.toThrow(/symbolic|symlink/i);
  expect(await readdir(target)).toEqual([]);
});

it("refuses forged references, altered attachments and paths outside a valid bundle", async () => {
  const { root, content } = await fixture();
  const source = resolve(root, imageName);
  await writeFile(source, png);
  const saved = await content.prepare(source, [source]);
  const [image] = await content.attachments(saved);
  await writeFile(image!, "changed");
  await expect(content.expand(saved)).rejects.toThrow(/checksum/);
  const forged = { ...saved, content: { ...saved.content!, bundleId: "../outside" } };
  expect(() => content.objectivePath(forged.content)).toThrow(/reference/);
  expect(await content.expand({ objective: `Read the full goal objective from ${JSON.stringify(source)}.` })).toContain(source);
  await expect(content.expand({ ...saved, objective: source })).rejects.toThrow(/reference/);
});

it("cleans only this failed draft and rejects non-images and oversized inputs", async () => {
  const { root, content } = await fixture();
  const old = await content.prepare("old".repeat(2000), []);
  const before = await readdir(content.root);
  const source = resolve(root, imageName);
  await writeFile(source, "not an image");
  await expect(content.prepare(source, [source])).rejects.toThrow(/image/);
  expect(await readdir(content.root)).toEqual(before);
  expect(await content.expand(old)).toBe("old".repeat(2000));
  expect(await readFile(source, "utf8")).toBe("not an image");
  await expect(content.prepare("x".repeat(1024 * 1024 + 1), [])).rejects.toThrow(/limit/);
  const draft = await content.prepare("new".repeat(2000), []);
  await content.discard(draft);
  await content.discard(old);
  expect(await readdir(content.root)).toEqual([]);
  await content.discard({ ...old });
});

it("edits into an independent package while preserving inherited attachment snapshots", async () => {
  const { root, content } = await fixture();
  const source = resolve(root, imageName);
  await writeFile(source, png);
  const original = await content.prepare(`Original ${source}`, [source]);
  await rm(source);
  const originalText = await content.expand(original);
  const edited = await content.prepare(originalText.replace("Original", "Changed"), [], original);
  expect(edited.content).toBeDefined();
  expect(edited.content!.bundleId).not.toBe(original.content!.bundleId);
  expect(await content.expand(original)).toBe(originalText);
  expect(await content.expand(edited)).toContain("Changed");
  expect((await content.attachments(edited))).toHaveLength(1);
  await content.discard(edited);
  expect(await content.expand(original)).toBe(originalText);
});

it("never deletes a replaced draft file or a substituted bundle directory during cleanup", async () => {
  const { root, content } = await fixture();
  const draft = await content.prepare("draft".repeat(1000), []);
  const objective = content.objectivePath(draft.content!);
  const userFile = resolve(root, "user-owned.txt");
  await writeFile(userFile, "Keep user file");
  await rm(objective);
  await symlink(userFile, objective);
  await content.discard(draft);
  expect(await readFile(objective, "utf8")).toBe("Keep user file");
  expect(await readFile(userFile, "utf8")).toBe("Keep user file");
  const second = await content.prepare("second".repeat(1000), []);
  const secondDirectory = resolve(content.root, second.content!.bundleId);
  await rm(secondDirectory, { recursive: true });
  await symlink(root, secondDirectory);
  await content.discard(second);
  expect(await readFile(resolve(secondDirectory, "user-owned.txt"), "utf8")).toBe("Keep user file");
});

it("recognizes only exact native paste tokens without opening files", async () => {
  const { root, content } = await fixture();
  const path = resolve(root, imageName);
  expect(content.candidates(`Inspect ${path} and \"${path}\".`)).toEqual([path]);
  expect(content.candidates(`prefix${path} ${path}.evil /other/${imageName} ${root}/../${imageName}`)).toEqual([]);
  const spaced = new GoalContent(resolve(root, "content"), resolve(root, "temporary folder"));
  const spacedPath = resolve(root, "temporary folder", imageName);
  expect(spaced.candidates(`Inspect ${spacedPath}`)).toEqual([spacedPath]);
});

it("bounds file reads and rejects symbolic links while reopening saved content", async () => {
  const { root, content } = await fixture();
  const source = resolve(root, imageName);
  await writeFile(source, Buffer.alloc(20 * 1024 * 1024 + 1));
  await expect(content.prepare(source, [source])).rejects.toThrow(/limit/);
  await writeFile(source, png);
  const saved = await content.prepare(source, [source]);
  const objective = content.objectivePath(saved.content!);
  await rm(objective);
  await symlink(source, objective);
  await expect(content.expand(saved)).rejects.toThrow();
  expect(() => content.candidates("x".repeat(1024 * 1024 + 1))).toThrow(/limit/);
  await expect(content.prepare(" ", [])).rejects.toThrow(/empty/);
  await expect(content.prepare(source, Array(33).fill(source))).rejects.toThrow(/limit/);
});

it("materializes long Unicode objectives and opens only their saved reference after restart", async () => {
  const { root, content } = await fixture();
  const text = "🧭".repeat(4001);
  const prepared = await content.prepare(text, []);
  expect([...prepared.objective].length).toBeLessThanOrEqual(4000);
  expect(prepared.content).toBeDefined();
  expect(await readFile(content.objectivePath(prepared.content!), "utf8")).toBe(text);
  expect(await new GoalContent(resolve(root, "content"), root).expand(prepared)).toBe(text);
  expect(await content.prepare("🧭".repeat(4000), [])).toMatchObject({ objective: "🧭".repeat(4000), content: undefined });
});
