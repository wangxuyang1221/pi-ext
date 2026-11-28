import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertSafePublishedPath } from "./package-paths.mjs";

for (const [name, theme] of [["codex-ui", "codex-pi"], ["claude-code-ui", "claude-code"]]) {
  const root = new URL(`../extensions/${name}/`, import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const entry = "dist/index.js";
  const palette = `themes/${theme}.json`;
  assert.equal(pkg.name, name);
  assert.deepEqual(pkg.pi, { extensions: [`./${entry}`], themes: [`./${palette}`] });
  assert.deepEqual(pkg.files, [entry, palette]);
  for (const file of pkg.files) assertSafePublishedPath(file);
  assert.equal(typeof (await import(new URL(entry, root).href)).default, "function");
  assert.equal(JSON.parse(await readFile(new URL(palette, root), "utf8")).name, theme);
  console.log(`Verified ${name} entry and ${theme} theme.`);
}
