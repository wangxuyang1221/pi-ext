import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(directory, '../../extensions/codex-ui/src');
const baselinePath = path.resolve(directory, process.env.PI_PERF_BASELINE ?? 'baselines/before.json.gz');
const baselineBytes = fs.readFileSync(baselinePath);
const baseline = JSON.parse(gunzipSync(baselineBytes));
const current = Object.fromEntries(fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.ts'))
  .sort().map(name => [name, fs.readFileSync(path.join(sourceDirectory, name), 'utf8')]));
const manifest = { baselineCommit: baseline.commit, baselineSnapshot: {
  path: path.relative(directory, baselinePath), sha256: createHash('sha256').update(baselineBytes).digest('hex'),
} };
for (const [variant, sources] of Object.entries({ before: baseline.sources, after: current })) {
  const outputDirectory = path.join(directory, '.generated', variant);
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  manifest[variant] = {};
  for (const [name, source] of Object.entries(sources)) {
    manifest[variant][name] = createHash('sha256').update(source).digest('hex');
    const output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
    }, fileName: name }).outputText;
    fs.writeFileSync(path.join(outputDirectory, name.replace(/\.ts$/, '.js')), output);
  }
}
const mcpDirectory = path.resolve(directory, '../../extensions/mcp/src');
const mcpCurrent = Object.fromEntries(fs.readdirSync(mcpDirectory).filter(name => name.endsWith('.ts')).sort()
  .map(name => [name, fs.readFileSync(path.join(mcpDirectory, name), 'utf8')]));
manifest.mcp = {};
for (const [variant, sources] of Object.entries({ before: baseline.mcp?.sources ?? {}, after: mcpCurrent })) {
  const destination = path.join(directory, '.generated', variant, 'mcp');
  fs.mkdirSync(destination, { recursive: true });
  manifest.mcp[variant] = {};
  for (const [name, source] of Object.entries(sources)) {
    manifest.mcp[variant][name] = createHash('sha256').update(source).digest('hex');
    fs.writeFileSync(path.join(destination, name.replace(/\.ts$/, '.js')), ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: name,
    }).outputText);
  }
}
fs.writeFileSync(path.join(directory, '.generated/build.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Built immutable before and production after variants.');
