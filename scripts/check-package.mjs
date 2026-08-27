import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const extensionEntries = packageJson.pi?.extensions ?? [];
const themeEntries = packageJson.pi?.themes ?? [];

if (extensionEntries.length !== 4) {
  throw new Error(`Expected 4 Pi extension entries, found ${extensionEntries.length}`);
}
if (themeEntries.length !== 1) {
  throw new Error(`Expected 1 Pi theme entry, found ${themeEntries.length}`);
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
  `Verified ${extensionEntries.length} compiled Pi extension entries and ${themeEntries.length} theme entry.`,
);
