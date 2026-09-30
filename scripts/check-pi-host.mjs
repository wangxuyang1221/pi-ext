import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectPiHost } from "./pi-host.mjs";

const host = inspectPiHost();
mkdirSync(resolve(".tmp"), { recursive: true });
const directory = mkdtempSync(resolve(".tmp/pi-host-check-"));
const inherited = { ...process.env };
try {
  Object.assign(process.env, { HOME: directory, USERPROFILE: directory, PI_CODING_AGENT_DIR: join(directory, "agent"),
    XDG_CACHE_HOME: join(directory, "cache"), XDG_CONFIG_HOME: join(directory, "config"),
    XDG_DATA_HOME: join(directory, "data"), XDG_STATE_HOME: join(directory, "state"),
    APPDATA: join(directory, "config"), LOCALAPPDATA: join(directory, "cache"),
    TMPDIR: directory, TMP: directory, TEMP: directory, PI_OFFLINE: "1", PI_TELEMETRY: "0" });
  const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const { builtInExtensions } = await import(pathToFileURL(join(host.root, "dist/extensions/index.js")).href);
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(manifest.pi.extensions.length, 8, "Published extension set changed");
  for (const variant of ["source", "dist"]) {
    const paths = manifest.pi.extensions.map(entry => resolve(variant === "source"
      ? entry.replace("/dist/", "/src/").replace(/\.js$/, ".ts") : entry));
    const loader = new DefaultResourceLoader({ cwd: directory, agentDir: join(directory, "agent"),
      settingsManager: SettingsManager.inMemory(), noExtensions: true, noSkills: true, noThemes: true,
      noContextFiles: true, noPromptTemplates: true,
      additionalExtensionPaths: ["builtin:mcp", "builtin:codemode", "builtin:tool-search", ...paths],
      extensionFactories: builtInExtensions });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    for (const entry of paths) assert.equal(result.extensions.filter(extension => extension.path === entry).length, 1);
    assert.equal(result.extensions.length, paths.length + 2);
    assert.equal(result.extensions.filter(extension => extension.path === "builtin:mcp").length, 0);
    assert.equal(result.extensions.filter(extension => extension.path === "builtin:codemode").length, 1);
    assert.equal(result.extensions.filter(extension => extension.path === "builtin:tool-search").length, 1);
    const warnings = result.warnings.filter(warning => warning.path === "builtin:mcp");
    assert.equal(warnings.length, 1, "Expected repository MCP to replace builtin MCP");
    console.log(JSON.stringify({ ...host, variant, extensions: paths.length, loadErrors: 0,
      replacementWarnings: warnings.map(warning => warning.warning) }));
  }
} finally {
  for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
  Object.assign(process.env, inherited);
  rmSync(directory, { recursive: true, force: true });
}
