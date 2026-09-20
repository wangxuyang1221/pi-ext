import { afterEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AgentSession, type Theme } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, Editor, type AutocompleteProvider, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../extensions/codex-ui/src/components.js";

// These probes exercise installed Pi classes, not a product extension or full TUI session.
const identity = (text: string) => text;
const editorTheme: EditorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI;
const theme = {
  fg: (_color: string, text: string) => text,
  getBgAnsi: () => "",
} as unknown as Theme;
const editors: Editor[] = [];
const fixtureDirectories: string[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.setText("");
  for (const path of fixtureDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function wrapSkills(current: AutocompleteProvider): AutocompleteProvider {
  return {
    triggerCharacters: ["$"],
    async getSuggestions(lines, row, col, options) {
      const match = lines[row]?.slice(0, col).match(/(?:^|[ \t])\$([a-z-]*)$/u);
      if (!match) return current.getSuggestions(lines, row, col, options);
      return {
        prefix: `$${match[1]}`,
        items: ["adventure", "research"]
          .filter(name => name.startsWith(match[1]))
          .map(name => ({ value: `$${name}`, label: `$${name}` })),
      };
    },
    applyCompletion: (...args) => current.applyCompletion(...args),
    shouldTriggerFileCompletion: (...args) => current.shouldTriggerFileCompletion?.(...args) ?? true,
  };
}

function createEditor(kind: "native" | "codex", withSkills = true) {
  const editor = kind === "native"
    ? new Editor(tui, editorTheme)
    : new CodexEditor(tui, editorTheme, { matches: () => false } as never, () => theme);
  const base = new CombinedAutocompleteProvider([{ name: "help", description: "Fixture command" }], process.cwd());
  editor.setAutocompleteProvider(withSkills ? wrapSkills(base) : base);
  editors.push(editor);
  return editor;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 80));

for (const kind of ["native", "codex"] as const) {
  test(`${kind}: dollar provider opens in the middle and preserves text after the cursor`, async () => {
    const editor = createEditor(kind);
    editor.setText("请用  帮我规划");
    for (let i = 0; i < " 帮我规划".length; i += 1) editor.handleInput("\x1b[D");
    for (const char of "$ad") editor.handleInput(char);
    await settle();
    expect(editor.isShowingAutocomplete()).toBe(true);
    editor.handleInput("\t");
    expect(editor.getText()).toBe("请用 $adventure 帮我规划");
  });

  for (const [keyName, key] of [["Tab", "\t"], ["Enter", "\r"]] as const) {
    test(`${kind}: ${keyName} selects a dollar candidate without submitting`, async () => {
      const editor = createEditor(kind);
      const submissions: string[] = [];
      editor.onSubmit = text => { submissions.push(text); };
      editor.setText("请用 ");
      for (const char of "$ad") editor.handleInput(char);
      await settle();
      expect(editor.isShowingAutocomplete()).toBe(true);
      editor.handleInput(key);
      expect(editor.getText()).toBe("请用 $adventure");
      expect(editor.isShowingAutocomplete()).toBe(false);
      expect(submissions).toEqual([]);
      editor.handleInput("\r");
      expect(submissions).toEqual(["请用 $adventure"]);
    });
  }

  test(`${kind}: dollar provider opens on a later line`, async () => {
    const editor = createEditor(kind);
    editor.setText("先看上下文\n然后用 ");
    editor.handleInput("$");
    await settle();
    expect(editor.isShowingAutocomplete()).toBe(true);
    editor.handleInput("\t");
    expect(editor.getText()).toBe("先看上下文\n然后用 $adventure");
  });

  test(`${kind}: slash completion survives the wrapper`, async () => {
    const editor = createEditor(kind);
    editor.handleInput("/");
    await settle();
    expect(editor.isShowingAutocomplete()).toBe(true);
    editor.handleInput("\t");
    expect(editor.getText()).toBe("/help ");
  });
}

test("native baseline does not open dollar completion without a provider", async () => {
  const editor = createEditor("native", false);
  editor.setText("请用 ");
  editor.handleInput("$");
  await settle();
  expect(editor.isShowingAutocomplete()).toBe(false);
});

test("native trigger boundaries do not include adjacency to ordinary Chinese characters", async () => {
  const editor = createEditor("native");
  editor.setText("请用");
  editor.handleInput("$");
  await settle();
  expect(editor.isShowingAutocomplete()).toBe(false);
});

function createExpansionHost() {
  const directory = mkdtempSync(join(process.cwd(), "adventure/experiments/.skill-probe-"));
  fixtureDirectories.push(directory);
  const filePath = join(directory, "fixture.md");
  writeFileSync(filePath, "---\nname: adventure\ndescription: Fixture\n---\n# Probe\n\nSKILL_PROBE_MARKER\n");
  // Private method access is confined to this source-level probe; it is not the proposed extension API.
  const session = Object.create(AgentSession.prototype) as any;
  session._resourceLoader = {
    getSkills: () => ({ skills: [{ name: "adventure", filePath, baseDir: dirname(filePath) }] }),
    getPrompts: () => ({ prompts: [] }),
  };
  const events: any[] = [];
  session._extensionRunner = {
    hasHandlers: () => true,
    emitInput: async (text: string, images: unknown, source: string, streamingBehavior: string) => {
      events.push({ text, images, source, streamingBehavior });
      return { action: "transform", text: `/skill:adventure ${text}` };
    },
    emitError: (error: unknown) => { throw new Error(JSON.stringify(error)); },
  };
  return { session, events, filePath };
}

test("native expansion is prefix-only and embeds actual skill contents", () => {
  const { session, filePath } = createExpansionHost();
  expect(session._expandSkillCommand("请用 /skill:adventure 帮我规划")).toBe("请用 /skill:adventure 帮我规划");
  const expanded = session._expandSkillCommand("/skill:adventure 请用 $adventure 帮我规划");
  expect(expanded).toContain(`location="${filePath}"`);
  expect(expanded).toContain("SKILL_PROBE_MARKER");
  expect(expanded).not.toContain("description: Fixture");
  expect(expanded).toContain("请用 $adventure 帮我规划");
  expect(readFileSync(filePath, "utf8")).toContain("SKILL_PROBE_MARKER");
});

for (const behavior of ["steer", "followUp"] as const) {
  test(`input transform reaches native expansion before ${behavior} queuing`, async () => {
    const { session, events } = createExpansionHost();
    const queued: any[] = [];
    Object.defineProperty(session, "isStreaming", { value: true });
    session._queueSteer = async (text: string, images: unknown) => queued.push({ text, images, behavior: "steer" });
    session._queueFollowUp = async (text: string, images: unknown) => queued.push({ text, images, behavior: "followUp" });
    const images = [{ type: "image", data: "FIXTURE", mimeType: "image/png" }];
    await session._queueUserInput("请用 $adventure 帮我规划", images, behavior, "interactive");
    expect(events).toEqual([{ text: "请用 $adventure 帮我规划", images, source: "interactive", streamingBehavior: behavior }]);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ images, behavior });
    expect(queued[0].text).toContain("SKILL_PROBE_MARKER");
    expect(queued[0].text).toContain("请用 $adventure 帮我规划");
  });
}
