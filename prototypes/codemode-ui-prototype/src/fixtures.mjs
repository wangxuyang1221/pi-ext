export const SCENARIOS = ['success', 'partial', 'error', 'running', 'many', 'empty'];

export function scriptFor(scenario) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  if (scenario === 'empty') return 'text("No tool calls were needed.");';
  if (scenario === 'many') return 'const results = await Promise.allSettled(Array.from({length: 24}, () => tools.read({path: "package.json"})));\ntext({files: results.length, matched: 3});';
  return [
    'const sources = await Promise.allSettled([',
    '  tools.read({path: "package.json"}),',
    '  tools.read({path: "配置.ts"})',
    ']);',
    'text({filesRead: sources.filter(x => x.status === "fulfilled").length});',
    'await tools.edit({path: "配置.ts", edits: [{oldText: "false", newText: "true"}]});',
    `const checks = await Promise.allSettled([tools.bash({command: "${scenario === 'running' ? 'fixture-hold' : scenario === 'success' ? 'fixture-test-pass' : 'fixture-test-fail'}"})]);`,
    'text(checks.map(x => x.status === "fulfilled" ? {status: "passed"} : {status: "failed", message: String(x.reason)}));',
    ...(scenario === 'error' ? ['throw new Error("Fixture post-processing failed; earlier edit remains applied");'] : []),
  ].join('\n');
}
