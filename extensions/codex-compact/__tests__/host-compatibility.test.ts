import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

test("loads every registered extension through the Pi 0.86.0 filesystem loader", async () => {
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
