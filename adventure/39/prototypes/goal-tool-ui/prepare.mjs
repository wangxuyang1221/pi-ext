import { readFile, readdir, mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

/** Transpile unchanged production sources into the isolated prototype runtime. */
export async function prepare(repo, target) {
  for (const extension of ["codex-ui", "goal"]) {
    await mkdir(join(target, extension), { recursive: true });
    const sourceDir = join(repo, "extensions", extension, "src");
    const files = extension === "goal" ? ["tools.ts", "upstream.ts", "renderers.ts"] : (await readdir(sourceDir)).filter(name => name.endsWith(".ts"));
    for (const name of files) {
      const source = await readFile(join(sourceDir, name), "utf8");
      const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      await writeFile(join(target, extension, name.replace(/\.ts$/, ".js")), output.outputText);
    }
  }
  await copyFile(join(repo, "themes/codex-pi.json"), join(target, "codex-pi.json"));
}
