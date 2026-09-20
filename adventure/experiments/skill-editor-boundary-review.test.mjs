import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// Run against the repository's installed package:
// node --test adventure/experiments/skill-editor-boundary-review.test.mjs
// Optional offline mode uses an unchanged snapshot of packages/tui/src at
// ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc, with its declared runtime dependencies:
// PI_REVIEW_TUI_SOURCE_ROOT=/path/to/src node --experimental-transform-types --test adventure/experiments/skill-editor-boundary-review.test.mjs
// Source snapshots are temporary review inputs, not files to commit with this probe.

const EXPECTED_VERSION = "0.86.0";
const EXPECTED_EDITOR_SHA256 = "241695859d48f49c6aaba9b9cfc14c6cd28639c6c247adb4fe2c202a9e2c6e20";
const PINNED_COMMIT = "ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc";
const sourceRoot = process.env.PI_REVIEW_TUI_SOURCE_ROOT;
let Editor;
let SelectList;
let CombinedAutocompleteProvider;
let editorSource;

if (sourceRoot) {
  const root = resolve(sourceRoot);
  editorSource = readFileSync(join(root, "components/editor.ts"), "utf8");
  const sourceHash = createHash("sha256").update(editorSource).digest("hex");
  assert.equal(sourceHash, EXPECTED_EDITOR_SHA256, "Offline Editor source must match the pinned Pi revision");
  ({ Editor } = await import(pathToFileURL(join(root, "components/editor.ts")).href));
  ({ SelectList } = await import(pathToFileURL(join(root, "components/select-list.ts")).href));
  ({ CombinedAutocompleteProvider } = await import(pathToFileURL(join(root, "autocomplete.ts")).href));
} else {
  const require = createRequire(import.meta.url);
  const packageEntry = require.resolve("@earendil-works/pi-tui");
  const distRoot = dirname(packageEntry);
  const manifest = JSON.parse(readFileSync(join(distRoot, "../package.json"), "utf8"));
  assert.equal(manifest.version, EXPECTED_VERSION, "Installed pi-tui must be the reviewed version");
  const map = JSON.parse(readFileSync(join(distRoot, "components/editor.js.map"), "utf8"));
  const sourceIndex = map.sources.findIndex(path => /(?:^|\/)components\/editor\.ts$/u.test(path));
  assert.ok(sourceIndex >= 0, "Published Editor source map must identify components/editor.ts");
  editorSource = map.sourcesContent?.[sourceIndex];
  assert.equal(typeof editorSource, "string", "Published Editor source map must contain the reviewed source");
  const sourceHash = createHash("sha256").update(editorSource).digest("hex");
  assert.equal(sourceHash, EXPECTED_EDITOR_SHA256, "Published Editor source must match the pinned Pi revision");
  ({ Editor, SelectList, CombinedAutocompleteProvider } = await import("@earendil-works/pi-tui"));
}

console.log(JSON.stringify({
  probe: "skill-editor-boundary-review",
  mode: sourceRoot ? "pinned-source" : "installed-package",
  node: process.version,
  reviewedVersion: EXPECTED_VERSION,
  commit: PINNED_COMMIT,
  editorSha256: createHash("sha256").update(editorSource).digest("hex"),
}));

// Real components: Editor, SelectList, CombinedAutocompleteProvider, and their
// dependencies. Substitutes: TUI host, identity theme, fixed skill inventory.
// This is a public-method feasibility probe, not a production extension or PTY
// test. It does not cover actual CodexEditor factory installation, app-level
// shortcuts, IME, mouse, undo, paste markers, async loading, reload, or coexistence.
const identity = value => value;
const theme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} };
const settle = () => new Promise(done => setTimeout(done, 50));

function createEditor() {
  const editor = new Editor(tui, theme);
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider([{ name: "help" }], process.cwd()));
  return editor;
}

function relaxedProvider(names) {
  const current = new CombinedAutocompleteProvider([{ name: "help" }], process.cwd());
  return {
    triggerCharacters: ["$"],
    async getSuggestions(lines, row, col, options) {
      const match = lines[row].slice(0, col).match(/\$([a-z-]*)$/u);
      if (!match) return current.getSuggestions(lines, row, col, options);
      return {
        prefix: "$" + match[1],
        items: names.filter(name => name.startsWith(match[1])).map(name => ({ value: "$" + name, label: "$" + name })),
      };
    },
    applyCompletion: current.applyCompletion.bind(current),
    shouldTriggerFileCompletion: () => true,
  };
}

// A small wrapper proving composition through public Editor and SelectList APIs.
// Its prefix-only matcher is a fixture, not the decided product grammar. All
// inspected members are public Editor methods; no private state or prototype is
// modified. A production wrapper must also coordinate native autocomplete,
// cancellation, focus, theme invalidation, app shortcuts, and lifecycle ownership.
function wrapWithMentionList(base, names) {
  let list;
  let prefix = "";
  return new Proxy(base, {
    get(target, key) {
      if (key === "handleInput") return data => {
        if (list && data === "\x1b") { list = undefined; return; }
        if (list && ["\x1b[A", "\x1b[B"].includes(data)) { list.handleInput(data); return; }
        if (list && (data === "\t" || data === "\r")) {
          const chosen = list.getSelectedItem();
          if (chosen) target.insertTextAtCursor(chosen.value.slice(prefix.length));
          list = undefined;
          return;
        }
        target.handleInput(data);
        const cursor = target.getCursor();
        const match = target.getLines()[cursor.line].slice(0, cursor.col).match(/\$([a-z-]*)$/u);
        if (!match) { list = undefined; return; }
        prefix = "$" + match[1];
        const items = names.filter(name => name.startsWith(match[1])).map(name => ({ value: "$" + name, label: "$" + name }));
        list = items.length ? new SelectList(items, 5, theme.selectList) : undefined;
      };
      if (key === "render") return width => [...target.render(width), ...(list?.render(width) ?? [])];
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("relaxing provider matching alone still does not auto-trigger beside Han characters", async () => {
  const editor = createEditor();
  editor.setAutocompleteProvider(relaxedProvider(["adventure", "research"]));
  editor.setText("请用");
  editor.handleInput("$");
  await settle();
  assert.equal(editor.isShowingAutocomplete(), false);
});

test("public Tab input bypasses boundary with multiple candidates and preserves suffix", async () => {
  const editor = createEditor();
  editor.setAutocompleteProvider(relaxedProvider(["adventure", "research"]));
  editor.setText("请用帮我规划");
  for (const _ of "帮我规划") editor.handleInput("\x1b[D");
  editor.handleInput("$");
  editor.handleInput("\t");
  await settle();
  assert.equal(editor.isShowingAutocomplete(), true);
  editor.handleInput("\t");
  assert.equal(editor.getText(), "请用$adventure帮我规划");
});

test("synthetic Tab has a single-candidate behavior difference", async () => {
  const editor = createEditor();
  editor.setAutocompleteProvider(relaxedProvider(["adventure"]));
  editor.setText("请用");
  editor.handleInput("$");
  editor.handleInput("\t");
  await settle();
  assert.equal(editor.isShowingAutocomplete(), false);
  assert.equal(editor.getText(), "请用$adventure");
});

test("public editor wrapper and SelectList support adjacency without private methods", () => {
  const editor = wrapWithMentionList(createEditor(), ["adventure"]);
  editor.setText("请用帮我规划");
  for (const _ of "帮我规划") editor.handleInput("\x1b[D");
  for (const char of "$ad") editor.handleInput(char);
  assert.ok(editor.render(80).some(line => line.includes("$adventure")));
  assert.equal(editor.getText(), "请用$ad帮我规划");
  editor.handleInput("\t");
  assert.equal(editor.getText(), "请用$adventure帮我规划");
});

test("public wrapper preserves native slash completion and native submission callbacks", async () => {
  const editor = wrapWithMentionList(createEditor(), ["adventure"]);
  let submitted;
  editor.onSubmit = text => { submitted = text; };
  editor.handleInput("/");
  await settle();
  assert.equal(editor.isShowingAutocomplete(), true);
  editor.handleInput("\t");
  assert.equal(editor.getText(), "/help ");
  editor.handleInput("\r");
  assert.equal(submitted, "/help");
});
