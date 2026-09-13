import { readFile, readdir, mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const git = promisify(execFile);
const BASELINE = "a5d430d3e586e5212606724332b1d7741869fc1d";

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Prototype source anchor changed: ${before}`);
  return source.replace(before, after);
}
export function patchSource(file, source) {
  const patches = {
    "codex-ui/bash-group-layout.ts": [
      ['theme.fg(color, "⏺")', 'marker(theme, color)'],
      ['for (const member of group.members) {', 'for (const member of group.members) {\n    theme = memberTheme(theme, member.id, member.status);'],
      ['const bodyColor = member.status === "failed" ? diagnostic(member)?.warning ? "warning" : "error" : "text";', 'const bodyColor = member.status === "failed" ? diagnostic(member)?.warning ? "warning" : "error" : "toolOutput";'],
    ],
    "codex-ui/read-group-layout.ts": [
      ['theme.fg(failed ? "error" : pending ? "warning" : "success", failed ? "×" : pending ? "◌" : "✓")', 'marker(theme, failed ? "error" : pending ? "warning" : "success")'],
      ['theme.fg("toolTitle", "Read")', 'theme.bold("Read")'],
      ['const cache = member.cache;', 'theme = memberTheme(theme, member.id, member.status);\n  const cache = member.cache;'],
    ],
    "codex-ui/tools.ts": [
      ['${theme.fg("warning", "◌")} ${theme.fg("muted", action)}  ', '${marker(theme, "warning")} ${theme.bold(action)} '],
      ['${theme.fg("error", "✗")}', '${marker(theme, "error")}'],
      ['`${ANSI_DIM}•${ANSI_INTENSITY_RESET}`', 'marker(theme, "success")'],
      ['theme.fg(presentation.color, presentation.glyph)', 'marker(theme, presentation.color)'],
    ],
    "mcp/renderers.ts": [
      ['theme.fg(isError ? "error" : isPartial ? "dim" : "success", "•")', 'marker(theme, isError ? "error" : isPartial ? "warning" : "success")'],
      ['theme.fg("dim", `${indent && index === 0 ? MCP_RESULT_BRANCH : indent}${line}`)', 'theme.fg("dim", indent && index === 0 ? MCP_RESULT_BRANCH : indent) + theme.fg("toolOutput", line)'],
      ['const color: ThemeColor = presentation.error ? "error" : "dim";', 'const color: ThemeColor = presentation.error ? "error" : "toolOutput";'],
      ['`${truncateToWidth(lines[lines.length - 1]!, Math.max(0, contentWidth - 3), "")}...`', '`${truncateToWidth(lines[lines.length - 1]!, Math.max(0, contentWidth - 3), "")}${theme.fg("dim", "...")}`'],
    ],
  }[file];
  if (!patches) return source;
  for (const [before, after] of patches) source = replaceOnce(source, before, after);
  return 'import { marker, memberTheme } from "../status.mjs";\n' + source;
}

/** Keep the approved prototype pinned; production checks copy built modules without source patches. */
export async function prepare(repo, target, before = false, production = false) {
  for (const extension of ["codex-ui", "mcp"]) {
    await mkdir(join(target, extension), { recursive: true });
    if (production) {
      const input = join(repo, "extensions", extension, "dist");
      for (const entry of await readdir(input)) if (entry.endsWith(".js")) await copyFile(join(input, entry), join(target, extension, entry));
      continue;
    }
    const { stdout } = await git("git", ["ls-tree", "-r", "--name-only", BASELINE, "--", `extensions/${extension}/src`], { cwd: repo });
    for (const path of stdout.trim().split("\n").filter(path => path.endsWith(".ts"))) {
      const entry = path.split("/").at(-1);
      const { stdout: source } = await git("git", ["show", `${BASELINE}:${path}`], { cwd: repo });
      const output = join(target, extension, entry.replace(/\.ts$/, ".js"));
      const transformed = before ? source : patchSource(`${extension}/${entry}`, source);
      await writeFile(output, ts.transpileModule(transformed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    }
  }
  await copyFile(join(repo, "prototypes/tool-status-prototype/status.mjs"), join(target, "status.mjs"));
  const theme = JSON.parse(await readFile(join(repo, "themes/codex-pi.json"), "utf8"));
  if (!before && !production) theme.colors.toolOutput = theme.colors.text;
  await writeFile(join(target, "codex-pi.json"), JSON.stringify(theme, null, 2) + "\n");
}
