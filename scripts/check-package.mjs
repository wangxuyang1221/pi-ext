import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSafePublishedPath } from "./package-paths.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const extensionEntries = packageJson.pi?.extensions ?? [];
const themeEntries = packageJson.pi?.themes ?? [];
const publishedEntries = packageJson.files ?? [];

function assertExactEntries(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected ${label}: ${JSON.stringify(actual)}`);
  }
}

async function assertPathExists(absolutePath, label) {
  try {
    await access(absolutePath);
  } catch (error) {
    throw new Error(`${label}: ${absolutePath}`, { cause: error });
  }
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

async function assertPublishedTreeIsSafe(entry) {
  assertSafePublishedPath(entry);
  const absolutePath = join(repositoryRoot, entry);
  const metadata = await stat(absolutePath);
  if (!metadata.isDirectory()) return;

  for (const relativePath of await listFiles(absolutePath, entry)) {
    assertSafePublishedPath(relativePath);
  }
}

assertExactEntries(extensionEntries, ["./extensions/codex-ui/dist/index.js"], "Pi extension entries");
assertExactEntries(themeEntries, ["./themes/codex-pi.json", "./themes/claude-code.json"], "Pi theme entries");

assertExactEntries(
  publishedEntries,
  ["extensions/codex-ui/dist", "themes/codex-pi.json", "themes/claude-code.json", "README.md", "README.en.md", "LICENSE"],
  "package files",
);

for (const entry of publishedEntries) {
  await assertPathExists(join(repositoryRoot, entry), "Published package path is missing");
  await assertPublishedTreeIsSafe(entry);
}

for (const entry of extensionEntries) {
  const file = join(repositoryRoot, entry.replace(/^\.\//, ""));
  await assertPathExists(file, "Compiled Pi extension entry is missing");
  await import(pathToFileURL(file).href);
}

for (const entry of themeEntries) {
  const file = join(repositoryRoot, entry.replace(/^\.\//, ""));
  const theme = JSON.parse(await readFile(file, "utf8"));
  if (typeof theme.name !== "string" || theme.name.length === 0) {
    throw new Error(`Pi theme entry has no name: ${entry}`);
  }
}

console.log(
  `Verified ${extensionEntries.length} compiled Pi extension entries, ${themeEntries.length} theme entry, and package exclusion boundaries.`,
);
