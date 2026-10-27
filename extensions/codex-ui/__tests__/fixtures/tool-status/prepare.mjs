import { readdir, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";

/** Preserve the built package layout, including cross-extension imports. */
export async function prepare(repo, target) {
  for (const extension of ["codex-ui", "mcp"]) {
    const input = join(repo, "extensions", extension, "dist");
    const output = join(target, extension, "dist");
    await mkdir(output, { recursive: true });
    for (const entry of await readdir(input)) if (entry.endsWith(".js")) await copyFile(join(input, entry), join(output, entry));
  }
  await copyFile(join(repo, "themes/codex-pi.json"), join(target, "codex-pi.json"));
}
