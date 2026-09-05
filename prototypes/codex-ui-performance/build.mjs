import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(directory, '../../extensions/codex-ui/src');
const baseline = JSON.parse(gunzipSync(fs.readFileSync(path.join(directory, 'baselines/before.json.gz'))));
const current = Object.fromEntries(fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.ts'))
  .sort().map(name => [name, fs.readFileSync(path.join(sourceDirectory, name), 'utf8')]));
const manifest = { baselineCommit: baseline.commit };
for (const [variant, sources] of Object.entries({ before: baseline.sources, after: current })) {
  const outputDirectory = path.join(directory, '.generated', variant);
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
fs.writeFileSync(path.join(directory, '.generated/build.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Built immutable before and production after variants.');
