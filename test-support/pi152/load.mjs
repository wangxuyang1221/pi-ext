import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager, createCodemodeExtension, createMcpExtension } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, TuiAltScreen } from "@earendil-works/pi-tui";
import { createTestEnvironment } from "../environment.mjs";
import { verifyMedia } from "../../scripts/codex-compact-media.mjs";
import { isHookPrompt, decodeOriginalImageBytes, decodeAudioDuration } from "../../extensions/codex-compact/dist/media-decoder.js";

assert.equal(process.env.PI_TEST_ISOLATED, "1", "Use the isolated launcher");
verifyMedia(resolve("extensions/codex-compact/dist/media"));
assert.equal(isHookPrompt('<hook_prompt hook_run_id="stock-proof">Check context</hook_prompt>'), true);
const mediaFixture = name => readFileSync(resolve("extensions/codex-compact/__tests__/fixtures/media", name)).toString("base64");
assert.equal(decodeOriginalImageBytes(`data:image/png;base64,${mediaFixture("patch-boundary.png")}`), 16);
assert.equal(decodeAudioDuration(`data:audio/wav;base64,${mediaFixture("one-second.wav")}`), 1);
const patched = process.argv.includes("--patched");
for (const renderer of [TuiMainScreen, TuiAltScreen]) {
  assert.equal(typeof renderer.prototype.registerTextRegion, patched ? "function" : "undefined", "Unexpected text-region capability");
}
const repo = process.cwd();
const names = ["codex-ui", "codex-compact", "openai-fast-mode", "mcp", "skill-mentions"];
const evidence = resolve(".tmp/load-proof.json");
const proof = [];
for (const kind of ["src", "dist"]) {
  const isolated = createTestEnvironment(`stock-load-${kind}`);
  try {
    const cwd = join(isolated.directory, "workspace");
    mkdirSync(cwd);
    const loader = new DefaultResourceLoader({ cwd, agentDir: isolated.env.PI_CODING_AGENT_DIR,
      settingsManager: SettingsManager.inMemory({}), noSkills: true, noPromptTemplates: true, noContextFiles: true,
      additionalExtensionPaths: names.map(name => join(repo, `extensions/${name}/${kind}/index.${kind === "src" ? "ts" : "js"}`)),
      additionalThemePaths: [join(repo, "themes/codex-pi.json")],
      extensionFactories: [
        { name: "mcp", factory: createMcpExtension(), builtin: true, replaceable: true },
        { name: "codemode", factory: createCodemodeExtension({ models: false }), builtin: true, replaceable: true },
      ],
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    const paths = result.extensions.map(extension => extension.path);
    assert.ok(paths.includes("builtin:codemode"));
    assert.ok(!paths.includes("builtin:mcp"));
    for (const name of names) assert.ok(paths.some(path => path.endsWith(`extensions/${name}/${kind}/index.${kind === "src" ? "ts" : "js"}`)));
    assert.ok(result.warnings.some(warning => warning.message?.includes("mcp") || warning.warning?.includes("mcp")));
    assert.ok(loader.getThemes().themes.some(theme => theme.name === "codex-pi"));
    assert.equal(result.extensions.some(extension => !!extension.sessionSummaryTransformer), patched);
    proof.push({ kind, paths, warnings: result.warnings, theme: "codex-pi", textRegion: patched, summaryTransformer: patched, cleanup: "removed" });
  } finally { rmSync(isolated.directory, { recursive: true, force: true }); }
}
writeFileSync(evidence, JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ evidence, proof, compiledMedia: { hookXml: true, originalImage: true, audio: true, manifestVerified: true } }));
