import { readFile, readdir, mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { execFileSync } from "node:child_process";

export async function prepare(repo, target, { baseline = false, production = false } = {}) {
  if (production) {
    await mkdir(target, { recursive: true });
    await copyFile(join(repo, "themes/codex-pi.json"), join(target, "codex-pi.json"));
    return;
  }
  const compile = async (source, destination) => {
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await writeFile(destination, result.outputText);
  };
  await mkdir(join(target, "codex-ui"), { recursive: true });
  for (const entry of await readdir(join(repo, "extensions/codex-ui/src"))) {
    if (!entry.endsWith(".ts")) continue;
    await compile(await readFile(join(repo, "extensions/codex-ui/src", entry), "utf8"), join(target, "codex-ui", entry.replace(/\.ts$/, ".js")));
  }
  for (const style of baseline ? ["before", "after"] : ["after"]) {
    await mkdir(join(target, style), { recursive: true });
    for (const entry of ["renderers.ts", "layout.ts"]) {
      const source = style === "before"
        ? execFileSync("git", ["show", `19e82a1:extensions/subagent/src/${entry}`], { cwd: repo, encoding: "utf8" })
        : await readFile(join(repo, "extensions/subagent/src", entry), "utf8");
      await compile(source, join(target, style, entry.replace(/\.ts$/, ".js")));
    }
  }
  await copyFile(join(repo, "themes/codex-pi.json"), join(target, "codex-pi.json"));
}
