import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const extensionEntries = packageJson.pi?.extensions ?? [];
const themeEntries = packageJson.pi?.themes ?? [];
const publishedEntries = packageJson.files ?? [];

const expectedExtensionEntries = [
  "./extensions/codex-compact/dist/index.js",
  "./extensions/openai-fast-mode/dist/index.js",
  "./extensions/permissions/dist/index.js",
  "./extensions/codex-ui/dist/index.js",
  "./extensions/mcp/dist/index.js",
  "./extensions/subagent/dist/index.js",
];
const expectedThemeEntries = ["./themes/codex-pi.json"];
const requiredPublishedEntries = [
  "extensions/codex-compact/dist",
  "extensions/codex-compact/LICENSE",
  "extensions/codex-compact/UPSTREAM.md",
  "extensions/openai-fast-mode/dist",
  "extensions/openai-fast-mode/LICENSE",
  "extensions/openai-fast-mode/UPSTREAM.md",
];

function assertExactEntries(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected ${label}: ${JSON.stringify(actual)}`);
  }
}

assertExactEntries(extensionEntries, expectedExtensionEntries, "Pi extension entries");
assertExactEntries(themeEntries, expectedThemeEntries, "Pi theme entries");

for (const entry of requiredPublishedEntries) {
  if (!publishedEntries.includes(entry)) {
    throw new Error(`Required package file is not published: ${entry}`);
  }
  await access(new URL(`../${entry}`, import.meta.url));
}

for (const entry of extensionEntries) {
  const file = new URL(`../${entry.replace(/^\.\//, "")}`, import.meta.url);
  await access(file);
  await import(file.href);
}

for (const entry of themeEntries) {
  const file = new URL(`../${entry.replace(/^\.\//, "")}`, import.meta.url);
  const theme = JSON.parse(await readFile(file, "utf8"));
  if (typeof theme.name !== "string" || theme.name.length === 0) {
    throw new Error(`Pi theme entry has no name: ${entry}`);
  }
}

console.log(
  `Verified ${extensionEntries.length} compiled Pi extension entries, ${themeEntries.length} theme entry, and required attribution files.`,
);
