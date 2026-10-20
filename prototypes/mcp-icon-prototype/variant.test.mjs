import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { prepare } from "./prepare.mjs";
import { variantTheme } from "./variant.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await mkdir(join(repo, ".tmp"), { recursive: true });
const root = await mkdtemp(join(repo, ".tmp/mcp-icon-test-"));
after(() => rm(root, { recursive: true, force: true }));
await prepare(repo, root);
const { renderMcpToolCall, renderMcpToolResult } = await import(pathToFileURL(join(root, "mcp/renderers.js")));
const theme = { fg: (_tone, value) => value, bold: value => value };

const productionRoot = join(root, "production");
await prepare(repo, productionRoot, true);
const production = await import(pathToFileURL(join(productionRoot, "mcp/renderers.js")));

test("production renders the approved wave prefix without a theme wrapper", () => {
  const colored = { fg: (tone, value) => `<${tone}>${value}</${tone}>`, bold: value => value };
  for (const names of [{ serverName: "exa", toolName: "web_search_exa" },
    { serverName: "chrome-devtools", toolName: "list_pages" }, { fullName: "mcp__ambiguous__name__search" }]) {
    const context = { state: {}, isPartial: false, isError: false };
    const call = production.renderMcpToolCall({}, names, colored, context);
    assert.ok(call.render(120)[0].startsWith("<warning>⌁</warning> <toolTitle>Calling"));
    for (const [isError, tone] of [[false, "muted"], [true, "error"]]) {
      production.renderMcpToolResult({ content: [{ type: "text", text: "⏺ ⌕ ⌁ body" }] },
        { expanded: false, isPartial: false }, colored, { ...context, isError });
      assert.ok(call.render(120)[0].startsWith(`<${tone}>⌁</${tone}> <toolTitle>`));
    }
  }
});

for (const [variant, glyph] of Object.entries({ "3": "⇄", "4": "::", chevron: "»", command: "⌘", wave: "⌁" })) {
  test(`variant ${variant} replaces search and non-search markers before width calculation`, () => {
    for (const names of [
      { serverName: "exa", toolName: "web_search_exa" },
      { serverName: "chrome-devtools", toolName: "list_pages" },
      { fullName: "mcp__ambiguous__name__search" },
    ]) {
      const state = {};
      const context = { state, isPartial: false, isError: false };
      const painted = variantTheme(theme, variant);
      const call = renderMcpToolCall({ query: "compare terminal icons" }, names, painted, context);
      assert.ok(call.render(100)[0].startsWith(`${glyph} Calling `));
      renderMcpToolResult({ content: [{ type: "text", text: "Fixture result" }], details: {} },
        { expanded: false, isPartial: false }, painted, context);
      assert.ok(call.render(100)[0].startsWith(`${glyph} Called `));
      for (const width of [1, 2, 8, 20, 40, 80, 120]) {
        assert.ok(call.render(width).every(line => visibleWidth(line) <= width));
      }
      renderMcpToolResult({ content: [{ type: "text", text: "Fixture failure" }], details: {} },
        { expanded: false, isPartial: false }, painted, { ...context, isError: true });
      assert.ok(call.render(100)[0].startsWith(`${glyph} Call failed for `));
    }
  });
}

for (const [variant, glyph] of Object.entries({ chevron: "»", command: "⌘", wave: "⌁" })) {
  test(`${variant} uses yellow running, gray success, and red failure for every tool`, () => {
    const colored = { fg: (tone, value) => `<${tone}>${value}</${tone}>`, bold: value => value };
    const painted = variantTheme(colored, variant);
    for (const toolName of ["web_search_exa", "list_pages"]) {
      const context = { state: {}, isPartial: false, isError: false };
      const call = renderMcpToolCall({}, { serverName: "fixture", toolName }, painted, context);
      assert.ok(call.render(120)[0].startsWith(`<warning>${glyph}</warning> `));
      const options = { expanded: false, isPartial: false };
      renderMcpToolResult({ content: [{ type: "text", text: "Done" }], details: {} }, options, colored, context);
      assert.ok(call.render(120)[0].startsWith(`<muted>${glyph}</muted> `));
      renderMcpToolResult({ content: [{ type: "text", text: "Failed" }], details: {} }, options, colored, { ...context, isError: true });
      assert.ok(call.render(120)[0].startsWith(`<error>${glyph}</error> `));
    }
    assert.equal(painted.fg("success", "Result body"), "<success>Result body</success>");
  });
}

test("earlier variants retain production tones and content", () => {
  const tones = [];
  const original = { fg: (tone, value) => { tones.push(tone); return value; }, bold: value => value };
  const wrapped = variantTheme(original, "4");
  assert.equal(wrapped.fg("warning", "⏺"), "::");
  assert.equal(wrapped.fg("muted", "⌕"), "::");
  assert.equal(wrapped.fg("text", "Body contains ⏺ and ⌕"), "Body contains ⏺ and ⌕");
  assert.equal(wrapped.bold("Called"), "Called");
  assert.deepEqual(tones, ["warning", "muted", "text"]);
  assert.throws(() => variantTheme(original, "unknown"), /Unknown icon variant/);
});
