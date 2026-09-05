import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(directory, '../../extensions/codex-ui/src');

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Expected one replacement: ${before.slice(0, 100)}`);
  return source.replace(before, after);
}
function replaceFunction(source, name, replacement) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  if (start < 0 || end < 0) throw new Error(`Missing function boundaries: ${name}`);
  return source.slice(0, start) + replacement.trim() + '\n' + source.slice(end);
}

function optimizeTools(source) {
  source = `import { id, memoLines, countVisualLines } from './cache.mjs';\n` + source;
  // P1.1: fitted output already satisfies the outer width after indentation.
  source = replaceOnce(source,
    'visualLines.map((line) => renderBashDetailLine(line, width))',
    'visualLines.map((line) => `${getBashDetailIndent(width)}${line}`)');
  // P1.2: callbacks can be rebound repeatedly before a frame is actually requested.
  source = replaceOnce(source, `      const metrics = getWriteMetrics(state, args.content, context.argsComplete);
      const suffix = theme.fg("dim", \`(\${formatLineCount(metrics.lineCount)})\`);
      return updateComponent(context.lastComponent, (width) => [
        fitToWidth(formatToolTitle("Write", path, theme, suffix), width),
      ]);`, `      if (typeof args.content !== "string") {
        const metrics = getWriteMetrics(state, args.content, context.argsComplete);
        const suffix = theme.fg("dim", \`(\${formatLineCount(metrics.lineCount)})\`);
        return updateComponent(context.lastComponent, (width) => [
          fitToWidth(formatToolTitle("Write", path, theme, suffix), width),
        ]);
      }
      return updateComponent(context.lastComponent, (width) => {
        const metrics = getWriteMetrics(state, args.content, context.argsComplete);
        const suffix = theme.fg("dim", \`(\${formatLineCount(metrics.lineCount)})\`);
        return [fitToWidth(formatToolTitle("Write", path, theme, suffix), width)];
      });`);
  source = replaceOnce(source, `      const metrics = getWriteMetrics(
        state,
        context.args.content,
        context.argsComplete || (!options.isPartial && !context.isError),
      );
      return updateComponent(context.lastComponent, (width) => renderWriteResult(
        result,
        metrics,
        options.isPartial,
        theme,
        context.isError,
        width,
      ));`, `      if (typeof context.args.content !== "string") {
        const metrics = getWriteMetrics(state, context.args.content,
          context.argsComplete || (!options.isPartial && !context.isError));
        return updateComponent(context.lastComponent, (width) => renderWriteResult(
          result, metrics, options.isPartial, theme, context.isError, width,
        ));
      }
      return updateComponent(context.lastComponent, (width) => {
        const metrics = getWriteMetrics(
          state, context.args.content,
          context.argsComplete || (!options.isPartial && !context.isError),
        );
        return renderWriteResult(result, metrics, options.isPartial, theme, context.isError, width);
      });`);
  source = replaceOnce(source, `  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 0x0a) lineCount += 1;
  }`, `  if (typeof content !== "string") {
    for (let index = 0; index < content.length; index += 1) {
      if (content.charCodeAt(index) === 0x0a) lineCount += 1;
    }
  } else {
    for (let index = content.indexOf("\\n"); index !== -1; index = content.indexOf("\\n", index + 1)) {
      lineCount += 1;
    }
  }`);
  // P1.3: retain exact upstream wrapping while avoiding padding and tail allocations.
  source = replaceOnce(source, `  const preview = getExactVisualTail(
    prepared.outputLines,
    (line) => line,
    getBashDetailContentWidth(width),
    1,
  );
  const count = preview.visualLines.length + preview.skippedCount;`, `  const count = countVisualLines(prepared.outputLines, getBashDetailContentWidth(width));`);
  // P2.5: cache rendered expanded layouts across collapse and width toggles.
  source = replaceOnce(source, 'function getEditResultLayout(', `function getEditResultLayout(...args) {
  const [state, result, diff, options, path, theme, isError, width] = args;
  if (!options.expanded) return getEditResultLayoutUncached(...args);
  const key = ["edit", id(diff ?? result.content), options.isPartial, isError, path,
    id(theme), getEditResultThemeFingerprint(theme), width].join("\\0");
  return memoLines(key, () => getEditResultLayoutUncached(...args));
}

function getEditResultLayoutUncached(`);
  // Store expanded rows rather than an unbounded extra copy of every syntax token.
  // The original highlight lifecycle remains intact, including collapse cleanup.
  source = replaceOnce(source, 'function layoutBashResult(', `function layoutBashResult(prepared, theme, width) {
  const key = ["bash", id(prepared.outputLines), id(theme), getBashResultThemeFingerprint(theme),
    width, prepared.warning].join("\\0");
  return memoLines(key, () => layoutBashResultUncached(prepared, theme, width));
}

function layoutBashResultUncached(`);
  // P2.6: preprocessing is lazy; output identity is independent of warnings and partial state.
  source = replaceOnce(source,
    'const prepared = prepareBashResult(result, isPartial);',
    'const prepared = prepareBashResult(result, isPartial, state);');
  source = replaceFunction(source, 'prepareBashResult', `function prepareBashResult(result, isPartial, state): PreparedBashResult {
  let lines;
  let warning;
  return {
    get outputLines() {
      if (lines !== undefined) return lines;
      let cache = state.outputPreparation;
      let extracted;
      if (cache?.content === result.content) extracted = cache.extracted;
      else extracted = extractBashOutput(result.content).trim();
      const output = removeBashExecutionFooter(extracted, result.details, isPartial);
      lines = cache?.output === output ? cache.lines : output ? output.split("\\n") : [];
      state.outputPreparation = { content: result.content, extracted, output, lines };
      return lines;
    },
    get warning() {
      return warning ??= formatBashTruncationWarning(result.details);
    },
    truncated: result.details?.truncation?.truncated === true,
  };
}`);
  // Cache output geometry separately so warnings do not invalidate it.
  source = replaceOnce(source, `  const visualLines = prepared.outputLines.length > 0
    ? getExactFittedVisualLines(
      prepared.outputLines,
      (line) => theme.fg("toolOutput", line),
      detailWidth,
    )
    : [];`, `  const bodyKey = ["bash-body", id(prepared.outputLines), id(theme),
    theme.fg("toolOutput", "x"), detailWidth].join("\\0");
  const visualLines = memoLines(bodyKey, () => prepared.outputLines.length > 0
    ? getExactFittedVisualLines(prepared.outputLines, (line) => theme.fg("toolOutput", line), detailWidth)
    : []);`);
  // P2.7: conservatively optimize printable ASCII only; Unicode and controls use the original path.
  // A 256-column prefix exceeds the summary's fixed 110-column maximum, preserving ellipsis.
  source = replaceOnce(source,
    '  const preview = sanitizeBashDisplayText(stripTerminalSequences(source))\n',
    '  const preview = (/^[\\x20-\\x7e]*$/u.test(source)\n    ? source.trim().slice(0, 256)\n    : sanitizeBashDisplayText(stripTerminalSequences(source)))\n');
  return source;
}

for (const variant of ['current', 'optimized']) {
  const outputDirectory = path.join(directory, '.generated', variant);
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const file of fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.ts'))) {
    let source = fs.readFileSync(path.join(sourceDirectory, file), 'utf8');
    if (variant === 'optimized' && file === 'tools.ts') source = optimizeTools(source);
    if (variant === 'optimized' && file === 'layout.ts') {
      source = replaceOnce(source, `  const fitted = truncateToWidth(text, safeWidth, options.ellipsis ?? "");
  if (!options.pad) return fitted;

  return \`\${fitted}\${" ".repeat(Math.max(0, safeWidth - visibleWidth(fitted)))}\`;`,
        '  return truncateToWidth(text, safeWidth, options.ellipsis ?? "", options.pad ?? false);');
    }
    const output = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    }, reportDiagnostics: true });
    if (output.diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(output.diagnostics, {
      getCanonicalFileName: value => value, getCurrentDirectory: () => directory, getNewLine: () => '\n',
    }));
    fs.writeFileSync(path.join(outputDirectory, file.replace(/\.ts$/, '.js')), output.outputText);
  }
  fs.copyFileSync(path.join(directory, 'cache.mjs'), path.join(outputDirectory, 'cache.mjs'));
}
console.log('Built isolated current and P1/P2 experimental renderers.');
