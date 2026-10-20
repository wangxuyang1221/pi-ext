import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

const git = promisify(execFile);
const MCP_BASELINE = "2499697d35c583f7f9d4ed1571efdcf2ebce3e7b";

export async function prepare(repo, target, production = false) {
  for (const extension of ["codex-ui", "mcp"]) {
    await mkdir(join(target, extension), { recursive: true });
    const input = join(repo, "extensions", extension, "src");
    for (const entry of await readdir(input)) {
      if (!entry.endsWith(".ts")) continue;
      // Pin only the comparison renderer; production always compiles the working tree unchanged.
      const source = !production && extension === "mcp" && entry === "renderers.ts"
        ? (await git("git", ["show", `${MCP_BASELINE}:extensions/mcp/src/renderers.ts`], { cwd: repo })).stdout
        : await readFile(join(input, entry), "utf8");
      const output = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      await writeFile(join(target, extension, entry.replace(/\.ts$/, ".js")), output);
    }
  }
  await copyFile(join(repo, "themes/codex-pi.json"), join(target, "codex-pi.json"));
}
