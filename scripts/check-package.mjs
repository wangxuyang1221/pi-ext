import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSafePublishedPath } from "./package-paths.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const extensionEntries = packageJson.pi?.extensions ?? [];
const themeEntries = packageJson.pi?.themes ?? [];
const publishedEntries = packageJson.files ?? [];

const expectedExtensionEntries = [
  "./extensions/codex-ui/dist/index.js",
  "./extensions/codex-compact/dist/index.js",
  "./extensions/openai-fast-mode/dist/index.js",
  "./extensions/permissions/dist/index.js",
  "./extensions/mcp/dist/index.js",
  "./extensions/subagent/dist/index.js",
  "./extensions/goal/dist/index.js",
  "./extensions/skill-mentions/dist/index.js",
];
const expectedThemeEntries = ["./themes/codex-pi.json"];
const requiredPublishedEntries = [
  "extensions/codex-compact/dist",
  "extensions/codex-compact/LICENSE",
  "extensions/codex-compact/UPSTREAM.md",
  "extensions/openai-fast-mode/dist",
  "extensions/openai-fast-mode/LICENSE",
  "extensions/openai-fast-mode/UPSTREAM.md",
  "extensions/mcp/dist",
  "extensions/goal/dist",
  "extensions/skill-mentions/dist",
  "extensions/goal/LICENSE",
  "extensions/goal/UPSTREAM.md",
  "extensions/goal/NOTICE",
];
const requiredMcpRuntimeExports = new Map([
  ["diagnostics.js", [
    "McpDiagnostics",
    "normalizeMcpError",
    "sanitizeDiagnosticText",
    "sanitizeDiagnosticValue",
    "summarizeHtml",
    "truncateUtf8",
  ]],
  ["retry.js", [
    "calculateMcpRetryDelay",
    "decideMcpRetry",
    "defaultMcpRetryScheduler",
    "parseHttpRetryAfter",
    "parseMcpRetryConfig",
    "scheduleMcpRetry",
    "shouldRetryMcpError",
  ]],
]);
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

assertExactEntries(extensionEntries, expectedExtensionEntries, "Pi extension entries");
assertExactEntries(themeEntries, expectedThemeEntries, "Pi theme entries");

for (const entry of requiredPublishedEntries) {
  if (!publishedEntries.includes(entry)) {
    throw new Error(`Required package file is not published: ${entry}`);
  }
  await assertPathExists(join(repositoryRoot, entry), "Required package path is missing");
}

for (const entry of publishedEntries) {
  await assertPathExists(join(repositoryRoot, entry), "Published package path is missing");
  await assertPublishedTreeIsSafe(entry);
}

const mcpSourceDirectory = join(repositoryRoot, "extensions/mcp/src");
const mcpDistDirectory = join(repositoryRoot, "extensions/mcp/dist");
const mcpSourceFiles = (await listFiles(mcpSourceDirectory))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));

for (const requiredSource of ["diagnostics.ts", "retry.ts"]) {
  if (!mcpSourceFiles.includes(requiredSource)) {
    throw new Error(`Required MCP source module is missing: ${requiredSource}`);
  }
}

const requiredGeneratedSuffixes = [".js", ".js.map", ".d.ts", ".d.ts.map"];
const expectedMcpGeneratedFiles = new Set();
for (const sourceFile of mcpSourceFiles) {
  const stem = sourceFile.slice(0, -".ts".length);
  for (const suffix of requiredGeneratedSuffixes) {
    const generatedFile = `${stem}${suffix}`;
    expectedMcpGeneratedFiles.add(generatedFile);
    await assertPathExists(
      join(mcpDistDirectory, generatedFile),
      "Generated MCP artifact is missing; run pnpm build",
    );
  }
}
for (const generatedFile of await listFiles(mcpDistDirectory)) {
  if (
    /(?:\.js|\.js\.map|\.d\.ts|\.d\.ts\.map)$/.test(generatedFile) &&
    !expectedMcpGeneratedFiles.has(generatedFile)
  ) {
    throw new Error(`Orphaned MCP generated artifact found; run pnpm build: ${generatedFile}`);
  }
}

for (const [moduleName, expectedExports] of requiredMcpRuntimeExports) {
  const modulePath = join(mcpDistDirectory, moduleName);
  const runtimeModule = await import(pathToFileURL(modulePath).href);
  for (const exportName of expectedExports) {
    if (!(exportName in runtimeModule)) {
      throw new Error(`Compiled MCP module ${moduleName} is missing export: ${exportName}`);
    }
  }
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
  `Verified ${extensionEntries.length} compiled Pi extension entries, ${themeEntries.length} theme entry, ${mcpSourceFiles.length} MCP generated modules, required MCP runtime exports, and package exclusion boundaries.`,
);
