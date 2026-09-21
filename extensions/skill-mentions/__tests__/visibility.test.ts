import { randomUUID } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import { initTheme, SessionManager, type ExtensionAPI, type ExtensionContext, type CustomEntry } from "@earendil-works/pi-coding-agent";
import skillMentions, { displayType } from "../src/index.js";
import { encodeSnapshot, type SkillSnapshot } from "../src/protocol.js";

beforeAll(() => initTheme("dark", false));
it.each([10, 100])("indexes active history once for %i cards and invalidates on a changed leaf", count => {
  const sm = SessionManager.inMemory(process.cwd());
  const displays: CustomEntry[] = [];
  for (let i = 0; i < count; i++) {
    const data: SkillSnapshot = { namespace: "pi-ext/skill-mentions", version: 1, requestId: randomUUID(), task: `$alpha ${i}`,
      skills: [{ name: "alpha", location: "/fixture/SKILL.md", baseDir: "/fixture", body: "BODY" }] };
    const id = sm.appendCustomEntry(displayType, data); displays.push(sm.getEntry(id) as CustomEntry);
    sm.appendMessage({ role: "user", content: encodeSnapshot(data), timestamp: i });
  }
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  let renderer!: (entry: any, options: any, theme: any) => any;
  skillMentions({ on: (event: string, handler: any) => handlers.set(event, handler),
    registerEntryRenderer: (_type: string, render: any) => { renderer = render; }, registerMarkdownTransformer() {}, registerCommand() {},
  } as unknown as ExtensionAPI);
  const scan = vi.spyOn(sm, "buildContextEntries");
  const ctx = { mode: "tui", sessionManager: sm, ui: { addAutocompleteProvider() {} } } as unknown as ExtensionContext;
  handlers.get("session_start")!({}, ctx);
  for (let repeat = 0; repeat < 3; repeat++) for (const entry of displays) expect(renderer(entry, { expanded: false }, {})).toBeDefined();
  expect(scan).toHaveBeenCalledTimes(1);
  sm.branch(displays[0].id);
  for (const entry of displays) expect(renderer(entry, { expanded: false }, {})).toBeUndefined();
  expect(scan).toHaveBeenCalledTimes(2);
  handlers.get("session_shutdown")!({}, ctx);
  expect(renderer(displays[0], { expanded: false }, {})).toBeUndefined();
  scan.mockRestore();
});
