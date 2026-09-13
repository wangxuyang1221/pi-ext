import { readdir, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

// Compile unmodified current sources into the isolated workspace, never dist/.
export async function prepare(repo, target) {
  for (const extension of ["codex-ui", "mcp"]) {
    const input = join(repo, "extensions", extension, "src");
    const output = join(target, extension);
    await mkdir(output, { recursive: true });
    for (const file of await readdir(input)) {
      if (!file.endsWith(".ts")) continue;
      const source = await readFile(join(input, file), "utf8");
      await writeFile(join(output, file.replace(/\.ts$/, ".js")), ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText);
    }
  }
  await copyFile(join(repo, "themes/codex-pi.json"), join(target, "codex-pi.json"));
}
