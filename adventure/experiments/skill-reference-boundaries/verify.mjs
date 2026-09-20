import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Probe a temporary copy of the actual parser; leave product behavior unchanged.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = await readFile(resolve(root, "extensions/skill-mentions/src/references.ts"), "utf8");
const punctuation = ",.;:!?，。；：！？、…)]}）］｝】》〉」』”’\"'";
const originalGate = "boundary(text[start - 1]) && boundary(text[end])";
const originalCompletion = "reference.end === cursor";
assert.equal(source.split(originalGate).length, 2);
assert.equal(source.split(originalCompletion).length, 2);
const helper = `
const punctuation = new Set(${JSON.stringify(punctuation)});
function activationRight(text: string, end: number): boolean {
  const char = text[end];
  if (boundary(char)) return true;
  if (!punctuation.has(char)) return false;
  const next = Array.from(text.slice(end + 1))[0] ?? "";
  return char !== "." || !/[\\p{L}\\p{N}_-]/u.test(next);
}
`;
const modified = source
  .replace(originalGate, "boundary(text[start - 1]) && activationRight(text, end)")
  .replace(originalCompletion, "reference.end === cursor && boundary(text[reference.end])") + helper;
await mkdir(resolve(root, ".tmp"), { recursive: true });
const temporary = await mkdtemp(resolve(root, ".tmp/reference-boundaries-"));
try {
  const path = resolve(temporary, "references.ts");
  await writeFile(path, modified);
  const { findReferences, completionReference } = await import(pathToFileURL(path).href);
  let checks = 0;
  for (const char of punctuation) {
    const text = `$alpha${char}`;
    assert.deepEqual(findReferences(text).map(x => x.name), ["alpha"], text);
    assert.equal(completionReference(text, 6), undefined, text);
    checks += 2;
  }
  const cases = [
    ["$alpha，继续", ["alpha"]], ["$alpha. next", ["alpha"]],
    ["$alpha.md", []], ["$alpha.中文", []], ["$alpha.𠮷", []],
    ["$alpha.1", []], ["$alpha._suffix", []], ["$alpha.-suffix", []],
    ["$alpha/beta", []], ["$alpha\\beta", []], ["$alpha@host", []],
    ["$alpha#anchor", []], ["$alpha+beta", []], ["$alpha=beta", []],
    ["文字$alpha，", []], ["（$alpha）", []], ["\\$alpha，", []],
    ["\\\\$alpha，", []], ["$alpha\r", []], ["$alpha\u00a0", []],
    ["` $alpha， ` $beta。", ["beta"]],
    ["```\n$alpha，\n```\n$beta。", ["beta"]],
    ["> ~~~\n> $alpha，\n> ~~~\n$beta。", ["beta"]],
    ["$alpha-beta， $alpha_beta。", ["alpha-beta", "alpha_beta"]],
    ["$alpha， $alpha。\n$beta！", ["alpha", "alpha", "beta"]],
    ["$5.00", []], ["$alpha：继续", ["alpha"]],
  ];
  for (const [text, expected] of cases) {
    const found = findReferences(text);
    assert.deepEqual(found.map(x => x.name), expected, text);
    for (const item of found) assert.equal(text.slice(item.start, item.end), `$${item.name}`);
    checks++;
  }
  assert.equal(completionReference("$al", 3)?.name, "al");
  assert.equal(completionReference("用 $al 后文", 5)?.name, "al");
  assert.equal(completionReference("$alpha", 3), undefined);
  assert.equal(completionReference("$al，", 3), undefined);
  checks += 4;
  console.log(JSON.stringify({ checks, punctuation, result: "passed", productChanged: false }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
