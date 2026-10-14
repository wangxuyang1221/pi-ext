import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { patchSource, readBaselineSource } from './prepare.mjs';

const read = file => readBaselineSource(fileURLToPath(new URL('../..', import.meta.url)), `extensions/${file}`);

test('uses muted success icons while preserving active and error colors', async () => {
  const source = patchSource('codex-ui/tool-status.ts', await read('codex-ui/src/tool-status.ts'));
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { toolStatusMarker } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const theme = { fg: (color, glyph) => ({ color, glyph }) };
  for (const [status, color] of Object.entries({ pending: 'warning', running: 'warning', completed: 'muted', failed: 'error', interrupted: 'warning', timed_out: 'warning' })) {
    assert.deepEqual(toolStatusMarker(theme, status), { color, glyph: '⚙︎' });
    assert.deepEqual(toolStatusMarker(theme, status, '⌘'), { color, glyph: '⌘' });
  }
});
