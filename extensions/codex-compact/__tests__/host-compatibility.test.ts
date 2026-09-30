import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { expectedPiVersion, inspectPiHost } from "../../../scripts/pi-host.mjs";

test("does not inherit provider credentials into the isolated check", () => {
  expect(process.env.OPENAI_API_KEY).toBeUndefined();
  expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
});

test("aligns supported Pi peers with the pinned host and refuses a mismatched baseline", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  for (const name of ["pi-ai", "pi-coding-agent", "pi-tui"]) {
    expect(manifest.peerDependencies[`@earendil-works/${name}`]).toBe(expectedPiVersion);
  }
  const info = inspectPiHost();
  expect(info.versions["pi-coding-agent"]).toBe(expectedPiVersion);
  expect(info.cli).toContain("pi-coding-agent");
  expect(() => inspectPiHost(info.root, "0.1.0")).toThrow("Installed Pi runtime version mismatch");
});

test("loads every registered extension through the pinned Pi filesystem loader", async () => {
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(resolve(".tmp/pi-host-"));
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const paths = manifest.pi.extensions.map((entry: string) => resolve(entry.replace("/dist/", "/src/").replace(/\.js$/, ".ts")));
    const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager: SettingsManager.inMemory(),
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      additionalExtensionPaths: paths,
    });
    await loader.reload();
    const result = loader.getExtensions();
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(paths.length);
    expect(result.extensions.flatMap(extension => [...extension.tools.keys()])).toContain("create_goal");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
