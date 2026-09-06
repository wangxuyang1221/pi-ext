import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const localRoot = path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const agentRoot = fs.realpathSync(process.env.PI_PERF_AGENT_ROOT ?? localRoot);
const scopeRoot = path.dirname(agentRoot);
const tuiRoot = fs.realpathSync(path.join(scopeRoot, 'pi-tui'));
const aiRoot = fs.realpathSync(path.join(scopeRoot, 'pi-ai'));
const agentVersion = JSON.parse(fs.readFileSync(path.join(agentRoot, 'package.json'), 'utf8')).version;
const generatedDirectory = path.join(directory, '.generated');
fs.mkdirSync(generatedDirectory, { recursive: true });

// Import actual unmodified renderer modules. The package root also loads unrelated optional servers.
const exports = {
  'modes/interactive/theme/theme.js': ['initTheme', 'theme', 'setTheme', 'setThemeInstance', 'loadThemeFromPath', 'getLanguageFromPath', 'highlightCode', 'getEditorTheme', 'getMarkdownTheme'],
  'modes/interactive/components/tool-execution.js': ['ToolExecutionComponent'],
  'modes/interactive/components/keybinding-hints.js': ['keyHint'],
  'modes/interactive/components/custom-editor.js': ['CustomEditor'],
  'modes/interactive/components/footer.js': ['FooterComponent'],
  'modes/interactive/components/assistant-message.js': ['AssistantMessageComponent'],
  'core/keybindings.js': ['KeybindingsManager'],
  'core/session-manager.js': ['sessionEntryToContextMessages'],
  'core/tools/truncate.js': ['DEFAULT_MAX_BYTES', 'DEFAULT_MAX_LINES', 'formatSize'],
  ...Object.fromEntries(['bash', 'edit', 'read', 'write'].map(name => [
    `core/tools/${name}.js`, [`create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`],
  ])),
};
const facade = path.join(generatedDirectory, 'agent.mjs');
fs.writeFileSync(facade, Object.entries(exports).map(([module, names]) => (
  `export { ${names.join(', ')} } from ${JSON.stringify(pathToFileURL(path.join(agentRoot, 'dist', module)).href)};`
)).join('\n') + `\nexport const VERSION = ${JSON.stringify(agentVersion)};\n`);

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@earendil-works/pi-coding-agent') return { url: pathToFileURL(facade).href, shortCircuit: true };
  if (specifier === '@earendil-works/pi-tui') return { url: pathToFileURL(path.join(tuiRoot, 'dist/index.js')).href, shortCircuit: true };
  if (specifier === 'benchmark:json-parser') return { url: pathToFileURL(path.join(aiRoot, 'dist/utils/json-parse.js')).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
function fingerprint(root) {
  const hash = createHash('sha256');
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
        hash.update(path.relative(root, file));
        hash.update(fs.readFileSync(file));
      }
    }
  }
  visit(path.join(root, 'dist'));
  return { root, version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    distSha256: hash.digest('hex') };
}
process.env.PI_PERF_AGENT_VERSION = agentVersion;
process.env.PI_PERF_SOURCES = JSON.stringify({
  build: JSON.parse(fs.readFileSync(path.join(generatedDirectory, 'build.json'), 'utf8')),
  benchmark: Object.fromEntries(fs.readdirSync(directory).filter(name => name.endsWith('.mjs')).sort()
    .map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')])),
  upstream: { agent: fingerprint(agentRoot), tui: fingerprint(tuiRoot), ai: fingerprint(aiRoot) },
});
await import(process.env.PI_PERF_ONLY === 'mcp' ? './mcp-bench.mjs' : process.argv.includes('--grouped') ? './grouped-probe.mjs' : process.argv.includes('--verify') ? './verify.mjs' : process.argv.includes('--memory') ? './memory.mjs' : './bench.mjs');
