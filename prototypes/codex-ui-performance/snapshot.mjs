import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const name = process.argv[2];
if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw new Error('Provide a unique snapshot name.');
const sourceDirectory = path.join(root, 'extensions/codex-ui/src');
const sources = Object.fromEntries(fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.ts')).sort()
  .map(name => [name, fs.readFileSync(path.join(sourceDirectory, name), 'utf8')]));
const hash = value => createHash('sha256').update(value).digest('hex');
const mcpDirectory = path.join(root, 'extensions/mcp/src');
const mcpSources = Object.fromEntries(fs.readdirSync(mcpDirectory).filter(name => name.endsWith('.ts')).sort()
  .map(name => [name, fs.readFileSync(path.join(mcpDirectory, name), 'utf8')]));
const snapshot = {
  mcp: { sources: mcpSources, sha256: Object.fromEntries(Object.entries(mcpSources).map(([name, source]) => [name, hash(source)])) },
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  createdAt: new Date().toISOString(), node: process.version,
  agentVersion: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version,
  sourceDiff: execFileSync('git', ['diff', 'HEAD', '--', 'extensions/codex-ui/src'], { cwd: root, encoding: 'utf8' }),
  sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, hash(source)])),
  inputs: Object.fromEntries(['themes/codex-pi.json', 'package.json', 'pnpm-lock.yaml'].map(name =>
    [name, { sha256: hash(fs.readFileSync(path.join(root, name))), content: fs.readFileSync(path.join(root, name), 'utf8') }])),
  sources,
};
const destination = path.join(directory, 'baselines', `${name}.json.gz`);
fs.writeFileSync(destination, gzipSync(JSON.stringify(snapshot)), { flag: 'wx' });
console.log(`Saved immutable snapshot: ${path.relative(root, destination)}`);
