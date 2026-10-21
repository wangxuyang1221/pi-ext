import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRow, renderInspector } from '../src/renderers.mjs';
import { visibleWidth } from '@earendil-works/pi-tui';

const theme = { fg: (_color, text) => text, bold: text => text };
const row = { id: 'run-1', status: 'completed', durationMs: 1800, code: 'SECRET_SCRIPT', output: 'Updated config', complete: true, calls: [
  { id: 'run-1/1', name: 'read', args: { path: 'package.json' }, status: 'ok', durationMs: 40 },
  { id: 'run-1/2', name: 'bash', args: { command: 'pnpm test' }, status: 'error', error: 'Exit code 1', durationMs: 800 },
] };

test('collapsed hybrid keeps nested failure visible without exposing script or successful child details', () => {
  const text = renderRow(row, { layout: 6, expanded: false, theme, width: 100 }).join('\n');
  assert.match(text, /Script completed/);
  assert.match(text, /1 failed/);
  assert.match(text, /pnpm test.*Exit code 1/);
  assert.doesNotMatch(text, /SECRET_SCRIPT|package\.json/);
});

test('tool errors never embed terminal newlines and collapsed output previews the script payload', () => {
  const multiline = { ...row, output: 'Script completed\nWall time 1.8 seconds\nOutput:\nFound 3 matches', calls: [{ ...row.calls[1], error: 'Assertion failed\n\nCommand exited with code 1' }] };
  const lines = renderRow(multiline, { layout: 6, expanded: false, theme, width: 120 });
  assert.ok(lines.every(line => !line.includes('\n')));
  assert.match(lines.join('\n'), /Found 3 matches/);
});

test('six layouts are distinct and fit narrow terminals in both expansion states', () => {
  const variants = new Set();
  for (let layout = 1; layout <= 6; layout++) {
    variants.add(renderRow(row, { layout, expanded: false, theme, width: 120 }).join('\n').split('\n').slice(1).join('\n'));
    for (const width of [1, 24, 40, 80, 120]) for (const expanded of [false, true]) {
      const lines = renderRow(row, { layout, expanded, theme, width });
      assert.ok(lines.every(line => visibleWidth(line) <= width), `${layout} @ ${width}`);
    }
  }
  assert.equal(variants.size, 6);
});

test('inspector exposes selected child, script and final output with responsive bounds', () => {
  for (const width of [24, 40, 120]) for (const tab of ['Calls', 'Script', 'Output']) {
    const lines = renderInspector(row, { theme, width, height: 16, selected: 1, tab, scroll: 0 });
    assert.ok(lines.length <= 16);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.match(lines.join('\n'), tab === 'Script' ? /SECRET_SCRIPT/ : tab === 'Output' ? /Updated config/ : /bash/);
  }
});
