import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const git = promisify(execFile);
const BASELINE = '9be165c2cb38862e1d3eb6729724ba1af9b7c272';
export async function readBaselineSource(repo, path) {
  return (await git('git', ['show', `${BASELINE}:${path}`], { cwd: repo })).stdout;
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Prototype source anchor changed: ${before}`);
  return source.replace(before, after);
}

export function patchSource(file, source) {
  const patches = {
    'codex-ui/tool-status.ts': [
      ['TOOL_STATUS_GLYPH = "⏺"', 'TOOL_STATUS_GLYPH = "⚙︎"'],
      ['completed: "success"', 'completed: "muted"'],
      ['status: ToolStatus): string {', 'status: ToolStatus, glyph: string = TOOL_STATUS_GLYPH): string {'],
      ['theme.fg(toolStatusColor(status), TOOL_STATUS_GLYPH)', 'theme.fg(toolStatusColor(status), glyph)'],
    ],
    'codex-ui/bash-group-layout.ts': [
      ['toolStatusMarker(theme, status)', 'toolStatusMarker(theme, status, "⌘")'],
    ],
    'codex-ui/tools.ts': [
      ['toolStatusMarker(theme, status === "failed" ? failureStatus ?? status : status)', 'toolStatusMarker(theme, status === "failed" ? failureStatus ?? status : status, "⌘")'],
    ],
    'mcp/renderers.ts': [
      ['isPartial ? "warning" : "success", "⏺"', 'isPartial ? "warning" : "muted", "⚙︎"'],
    ],
  }[file] ?? [];
  for (const [before, after] of patches) source = replaceOnce(source, before, after);
  return source;
}

export function patchSymbols(file, source) {
  source = patchSource(file, source);
  const patches = {
    'codex-ui/tool-status.ts': [
      ['TOOL_STATUS_GLYPH = "⚙︎"', 'TOOL_STATUS_GLYPH = "~"'],
    ],
    'codex-ui/bash-group-layout.ts': [['toolStatusMarker(theme, status, "⌘")', 'toolStatusMarker(theme, status, "$")']],
    'codex-ui/read-group-layout.ts': [['toolStatusMarker(theme, status)', 'toolStatusMarker(theme, status, "@")']],
    'codex-ui/tools.ts': [['failureStatus ?? status : status, "⌘")', 'failureStatus ?? status : status, "$")']],
    'mcp/renderers.ts': [[
      'theme.fg(isError ? warning ? "warning" : "error" : isPartial ? "warning" : "muted", "⚙︎")',
      'theme.fg(isError ? warning ? "warning" : "error" : isPartial ? "warning" : "muted", "⌕")',
    ]],
  }[file] ?? [];
  for (const [before, after] of patches) source = replaceOnce(source, before, after);
  return source;
}

export function patchSubagent(source) {
  source = replaceOnce(source, 'theme.fg(callStatusColor(kind, state), "⏺")', 'theme.fg(callStatusColor(kind, state), "󱙺")');
  source = replaceOnce(source, 'function callStatusColor(kind: SubagentToolKind, state: RendererState): "warning" | "error" | "success"', 'function callStatusColor(kind: SubagentToolKind, state: RendererState): "warning" | "error" | "muted"');
  return replaceOnce(source, '\n  return "success";\n}', '\n  return "muted";\n}');
}

export async function prepare(repo, target, before = false, symbols = false, subagent = false, productionSubagent = false) {
  for (const extension of ['codex-ui', 'mcp']) {
    await mkdir(join(target, extension), { recursive: true });
    const { stdout } = await git('git', ['ls-tree', '-r', '--name-only', BASELINE, '--', `extensions/${extension}/src`], { cwd: repo });
    for (const path of stdout.trim().split('\n').filter(path => path.endsWith('.ts'))) {
      const entry = path.split('/').at(-1);
      const source = await readBaselineSource(repo, path);
      await writeFile(join(target, extension, entry.replace(/\.ts$/, '.js')), ts.transpileModule(
        before ? source : (symbols ? patchSymbols : patchSource)(`${extension}/${entry}`, source),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
      ).outputText);
    }
  }
  await mkdir(join(target, 'subagent'), { recursive: true });
  for (const file of ['renderers', 'layout']) {
    const path = `extensions/subagent/src/${file}.ts`;
    const source = productionSubagent ? await readFile(join(repo, path), 'utf8') : await readBaselineSource(repo, path);
    await writeFile(join(target, `subagent/${file}.js`), ts.transpileModule(
      file === 'renderers' && !before && !productionSubagent ? patchSubagent(source) : source,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
    ).outputText);
  }
  await writeFile(join(target, 'subagent-demo.mjs'), await readFile(join(repo, 'prototypes/tool-icon-prototype/subagent-demo.mjs'), 'utf8'));
  const theme = JSON.parse(await readFile(join(repo, 'themes/codex-pi.json'), 'utf8'));
  await writeFile(join(target, 'codex-pi.json'), JSON.stringify(theme));
  const base = join(repo, 'prototypes/tool-status-prototype');
  let runtime = await readFile(join(base, 'runtime.mjs'), 'utf8');
  for (const file of ['scenarios.mjs', 'playback.mjs']) {
    runtime = replaceOnce(runtime, `"./${file}"`, JSON.stringify(pathToFileURL(join(base, file)).href));
  }
  runtime = replaceOnce(runtime, '"Tool status prototype · "', '"Tool icon prototype · "');
  runtime = replaceOnce(runtime, '"Unified style"', JSON.stringify(before ? 'Original dots' : symbols ? 'Status symbols: $ Bash / @ Read / ~ Edit & Write / ⌕ Search' : 'Command ⌘ / Tool ⚙︎'));
  runtime = 'import { registerSubagentDemo } from "./subagent-demo.mjs";\n' + runtime;
  runtime = replaceOnce(runtime, '  codexUi?.(proxy);', '  codexUi?.(proxy);\n  registerSubagentDemo(pi, faux, ai, busy);');
  runtime = replaceOnce(runtime, '/play · /play mixed · /play batch · /play stop', '/agents mixed|success|error · /play · /play mixed · /play batch · /play stop');
  runtime = replaceOnce(runtime, 'mcpOnly ? "/demo mcp success" : "/demo all success"', JSON.stringify(subagent ? '/agents mixed' : '/play'));
  await writeFile(join(target, 'runtime.mjs'), runtime);
}
