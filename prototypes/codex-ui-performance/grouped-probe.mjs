import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import ts from 'typescript';
import xterm from '@xterm/headless';
import { ToolExecutionComponent, loadThemeFromPath, setThemeInstance } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { makeScreen, chrome, feed, measured, summary, completedRows } from './bench.mjs';
import { cwd, directory, outputDirectory, width, height, definitions, fixtures, textResult, advance, restoreClock, save } from './shared.mjs';

// Transpile the accepted renderer without modifying it or production sources.
const prototypePath = path.join(cwd, 'prototypes/codex-bash-ui-prototype/src/renderers.ts');
const prototypeSource = fs.readFileSync(prototypePath, 'utf8');
const compiledPath = path.join(outputDirectory, 'grouped-renderer.mjs');
fs.writeFileSync(compiledPath, ts.transpileModule(prototypeSource.replace(
  '../../../extensions/codex-ui/src/layout.js', './before/layout.js'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
const { renderGroup } = await import(pathToFileURL(compiledPath).href);
const palettePath = path.join(cwd, 'themes/codex-pi.json');
setThemeInstance(loadThemeFromPath(palettePath, 'truecolor'));
const hash = value => createHash('sha256').update(value).digest('hex');
const placements = (process.env.PI_PERF_GROUPED_ORDER ?? 'production,grouped-top,grouped-bottom-probe').split(',');
assert.deepEqual([...placements].sort(), ['grouped-bottom-probe', 'grouped-top', 'production']);
const report = {
  environment: { ...JSON.parse(process.env.PI_PERF_SOURCES), node: process.version, cpu: os.cpus()[0]?.model,
    timestamp: new Date().toISOString(), width, height, warmupFrames: 4, measuredFrames: 10,
    palette: 'codex-pi', paletteSha256: hash(fs.readFileSync(palettePath)),
    prototypeSha256: hash(prototypeSource), placements,
    note: 'Layout feasibility probe, not production grouping or a cache performance acceptance test. Fixture execution; real tool components, TUI and awaited xterm parsing. Bottom placement is an unapproved experiment.' },
  pipeline: [],
};

function groupedRows(count, fixture, expanded, running, screen, placement) {
  const members = Array.from({ length: count }, (_, index) => ({ id: `grouped-${index}`, command: `printf member-${index}`,
    status: 'pending', durationMs: 0, output: [], truncated: false }));
  let leaderContext;
  let notifying = false;
  const empty = { render: () => [], invalidate() {} };
  const notify = () => {
    if (notifying) return;
    notifying = true;
    try { leaderContext?.invalidate(); } finally { notifying = false; }
  };
  const definition = {
    name: 'bash', label: 'bash', description: 'Fixture only', parameters: { type: 'object' }, renderShell: 'self',
    execute() { throw new Error('This probe must not execute commands.'); },
    renderCall(args, theme, context) {
      const member = members.find(member => member.id === context.toolCallId);
      member.command = args.command;
      if (context.executionStarted && context.isPartial) member.status = 'running';
      if (member !== members[0]) return empty;
      leaderContext = context;
      return { invalidate() {}, render(columns) {
        if (placement === 'grouped-top') return renderGroup(members, context.expanded, theme, columns, 'ctrl+o');
        // Keep commands and statistics intact, but place ticking durations after the group's output.
        const stable = members.map(member => member.status === 'running' ? { ...member, durationMs: 0 } : member);
        const lines = renderGroup(stable, context.expanded, theme, columns, 'ctrl+o');
        if (!context.expanded) return renderGroup(members, false, theme, columns, 'ctrl+o');
        for (let index = 0; index < lines.length; index++) lines[index] = lines[index].replace('0.0s running', ' '.repeat(12));
        lines.push(theme.fg('dim', members.flatMap((member, index) => member.status === 'running'
          ? [`${index + 1}: ${(member.durationMs / 1000).toFixed(1)}s running`] : []).join(' · ')));
        return lines;
      } };
    },
    renderResult(result, options, _theme, context) {
      const member = members.find(member => member.id === context.toolCallId);
      member.status = options.isPartial ? 'running' : context.isError ? 'failed' : 'completed';
      const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      if (member.text !== text) { member.text = text; member.output = text ? text.split('\n') : []; }
      if (member !== members[0]) notify();
      return empty;
    },
  };
  const rows = members.map(member => new ToolExecutionComponent('bash', member.id, { command: member.command },
    { showImages: false }, definition, screen, cwd));
  rows.forEach((row, index) => {
    row.setExpanded(expanded); row.setArgsComplete();
    const active = running === 'all' || index === count - 1;
    if (active) row.markExecutionStarted();
    row.updateResult(fixture.result, active);
  });
  const timer = setInterval(() => {
    for (const member of members) if (member.status === 'running') member.durationMs += 1000;
    notify();
  }, 1000);
  return { rows, dispose: () => { clearInterval(timer); leaderContext = undefined; } };
}

function grid(terminal) {
  const buffer = terminal.buffer.active;
  return Array.from({ length: terminal.rows }, (_, y) => Array.from({ length: terminal.cols }, (_, x) => {
    const cell = buffer.getLine(buffer.viewportY + y)?.getCell(x);
    return cell && [cell.getChars(), cell.getWidth(), cell.getFgColorMode(), cell.getFgColor(), cell.getBgColorMode(),
      cell.getBgColor(), cell.isBold(), cell.isItalic(), cell.isUnderline()];
  }));
}

async function pipeline(fixture, mode, history, expanded, count, running, placement) {
  const owner = definitions('before');
  const { screen, terminal } = makeScreen(mode);
  const parsed = new xterm.Terminal({ cols: width, rows: height, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
  const { editor, footer, assistant } = chrome('before', screen);
  let group;
  try {
    completedRows(owner, screen, history, expanded);
    screen.addChild(assistant);
    const rows = placement === 'production' ? Array.from({ length: count }, (_, index) => {
      const row = owner.row('bash', { command: `printf member-${index}` }, screen);
      row.setExpanded(expanded); row.setArgsComplete();
      const active = running === 'all' || index === count - 1;
      if (active) row.markExecutionStarted();
      row.updateResult(fixture.result, active);
      return row;
    }) : (group = groupedRows(count, fixture, expanded, running, screen, placement)).rows;
    rows.forEach(row => screen.addChild(row));
    screen.addChild(editor); screen.addChild(footer);
    screen.renderNow(); await feed(parsed, terminal.take());
    if (group) {
      assert.ok(rows.slice(1).every(row => row.render(width).length === 0), 'Hidden members must not retain spacing');
      const text = stripTerminalSequences(rows[0].render(width).join('\n'));
      for (let index = 0; index < count; index++) if (expanded || running === 'all' || index === count - 1)
        assert.equal(text.split(`$ printf member-${index}`).length - 1, 1, 'Each shown command must appear once');
    }
    const samples = [];
    for (let index = 0; index < 14; index++) {
      const redraws = screen.fullRedraws;
      const node = measured(() => { advance(1000); screen.renderNow(); });
      const data = terminal.take();
      const parser = await feed(parsed, data);
      const fullRedraws = screen.fullRedraws - redraws;
      const expectedReplay = mode === 'regular' && expanded && (placement === 'grouped-top'
        || (placement === 'production' && count > 1 && running === 'all'));
      assert.equal(fullRedraws, expectedReplay ? 1 : 0, `${placement}/${mode}/${count}/${running}/${expanded}`);
      if (index >= 4) samples.push({ nodeWallMs: node.wallMs, nodeCpuMs: node.cpuMs,
        parserWallMs: parser.wallMs, parserCpuMs: parser.cpuMs, totalCpuMs: node.cpuMs + parser.cpuMs,
        totalWallMs: node.wallMs + parser.wallMs, bytes: Buffer.byteLength(data), fullRedraws });
    }
    // Verify the final parsed viewport against a fresh draw, outside measured frames.
    const reference = makeScreen(mode);
    const expected = new xterm.Terminal({ cols: width, rows: height, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
    try {
      for (const child of screen.children) reference.screen.addChild(child);
      reference.screen.renderNow(); await feed(expected, reference.terminal.take());
      assert.deepEqual(grid(parsed), grid(expected), 'Incremental viewport must match a fresh draw');
    } finally { reference.screen.stop(); expected.dispose(); }
    report.pipeline.push({ fixture: fixture.id, mode, history, expanded, count, running, placement, event: 'tick',
      viewportVerified: true, ...Object.fromEntries(Object.keys(samples[0]).map(key => [key, summary(samples.map(sample => sample[key]))])) });
  } finally { group?.dispose(); owner.dispose(); footer.dispose(); screen.stop(); parsed.dispose(); }
}

try {
  for (const fixture of fixtures.filter(fixture => ['bash-lines-1800', 'bash-token-50k'].includes(fixture.id)))
    for (const mode of ['regular', 'fullscreen']) for (const history of [0, 20]) for (const expanded of [false, true])
      for (const count of [1, 3]) for (const running of count === 1 ? ['last'] : ['last', 'all']) {
        for (const placement of placements) await pipeline(fixture, mode, history, expanded, count, running, placement);
        console.log(`Probed ${fixture.id}/${mode}/${history}/${expanded}/${count}/${running}`);
        save('grouped-probe.json', report);
      }
  console.log(`Saved ${save('grouped-probe.json', report)}`);
} finally { restoreClock(); }
