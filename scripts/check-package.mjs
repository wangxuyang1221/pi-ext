import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const entries = packageJson.pi?.extensions ?? [];

if (entries.length !== 2) {
  throw new Error(`Expected 2 Pi extension entries, found ${entries.length}`);
}

for (const entry of entries) {
  const file = new URL(`../${entry.replace(/^\.\//, "")}`, import.meta.url);
  await access(file);
  await import(file.href);
}

console.log(`Verified ${entries.length} compiled Pi extension entries.`);
