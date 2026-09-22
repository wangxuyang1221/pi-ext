import { readFile, readdir, mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Prototype anchor changed: ${before}`);
  return source.replace(before, after);
}

export function patchRenderer(source) {
  source = 'import { toolStatusMarker } from "../codex-ui/tool-status.js";\n' + source;
  source = replaceOnce(source, 'theme.fg("dim", "•"),', `toolStatusMarker(theme, state.isError ? "failed" : state.isPartial ? "running"
      : kind === "wait" && state.details?.outcome === "timeout" ? "timed_out"
      : kind === "wait" && state.details?.outcome === "interrupted" ? "interrupted" : "completed"),`);
  source = replaceOnce(source, 'if (target) parts.push(theme.fg("accent", theme.bold(target)));', 'if (target) parts.push(theme.fg("accent", target));');
  source = source.replaceAll('theme.fg("toolOutput",', 'theme.fg("text",');
  source = source.replaceAll('"error" : "toolOutput"', '"error" : "text"');
  source = replaceOnce(source, 'theme.fg("accent", theme.bold(agent.name)),', 'theme.fg("accent", agent.name),');
  source = replaceOnce(source, 'theme.fg("muted", activitySummaryParts(details, true).join(" · "))', 'theme.fg("dim", activitySummaryParts(details, true).join(" · "))');
  source = replaceOnce(source, 'const prefix = theme.fg("dim", index === 0 ? "  └ " : "    ");', 'const prefix = theme.fg("dim", index === lines.length - 1 ? "  └ " : "  │ ");');
  return source;
}

export async function prepare(repo, target) {
  const compile = async (source, destination) => {
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await writeFile(destination, result.outputText);
  };
  await mkdir(join(target, "codex-ui"), { recursive: true });
  for (const entry of await readdir(join(repo, "extensions/codex-ui/src"))) {
    if (!entry.endsWith(".ts")) continue;
    await compile(await readFile(join(repo, "extensions/codex-ui/src", entry), "utf8"), join(target, "codex-ui", entry.replace(/\.ts$/, ".js")));
  }
  for (const style of ["before", "after"]) {
    await mkdir(join(target, style), { recursive: true });
    for (const entry of ["renderers.ts", "layout.ts"]) {
      let source = await readFile(join(repo, "extensions/subagent/src", entry), "utf8");
      if (style === "after" && entry === "renderers.ts") source = patchRenderer(source);
      await compile(source, join(target, style, entry.replace(/\.ts$/, ".js")));
    }
  }
  await copyFile(join(repo, "themes/codex-pi.json"), join(target, "codex-pi.json"));
}
