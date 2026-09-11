import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.env.PI_MCP_TEST_PI_ROOT ?? '');
if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version !== '0.85.1') throw new Error('Expected Pi 0.85.1');
const repo = process.cwd();
mkdirSync('.tmp', { recursive: true });
const run = mkdtempSync(resolve('.tmp/mcp-benchmark-'));
try {
  for (const name of ['home', 'agent', 'tmp', 'cache']) mkdirSync(join(run, name));
  Object.assign(process.env, { HOME: join(run, 'home'), PI_CODING_AGENT_DIR: join(run, 'agent'), TMPDIR: join(run, 'tmp'),
    XDG_CACHE_HOME: join(run, 'cache'), JITI_FS_CACHE: join(run, 'cache'), PI_MCP_TEST_PI_ROOT: root });
  process.env.MCP_BENCH_EXTENSION = resolve('extensions/mcp/src/index.ts');
  if (process.argv.includes('--baseline')) {
    cpSync('extensions/mcp/src', join(run, 'source'), { recursive: true });
    writeFileSync(join(run, 'source/index.ts'), execFileSync('git', ['show', 'HEAD:extensions/mcp/src/index.ts'], { cwd: repo }));
    process.env.MCP_BENCH_EXTENSION = join(run, 'source/index.ts');
    process.env.MCP_BENCH_BASELINE = '1';
  }
  const loader = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')).href);
  const result = await loader.loadExtensions([resolve('extensions/mcp/__tests__/fixtures/history-benchmark.ts')], run);
  if (result.errors.length) throw new Error(JSON.stringify(result.errors));
} finally { rmSync(run, { recursive: true, force: true }); }
