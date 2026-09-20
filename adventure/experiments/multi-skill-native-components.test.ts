import { beforeAll, expect, test } from "vitest";
import { SessionManager, SkillInvocationMessageComponent, convertToLlm, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { CustomEntryComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-entry.js";

// Planning probe only. The private host component is inspected, not proposed as a product dependency.
// The extension renderer below creates exported native components via public constructors.
beforeAll(() => initTheme("dark", false));

const snapshots = [
  { name: "research", location: "/fixture/research/SKILL.md", content: "References are relative to /fixture/research.\n\nRESEARCH_BODY_MARKER" },
  { name: "adventure", location: "/fixture/adventure/SKILL.md", content: "References are relative to /fixture/adventure.\n\nADVENTURE_BODY_MARKER" },
];
const task = "请用 $research 和 $adventure 规划";
// This self-contained envelope is a fixture, not an approved storage protocol.
const payload = JSON.stringify({ kind: "multi-skill-probe", task, snapshots });
const displayType = "multi-skill-probe-display";

function renderNativeCards(_entry: unknown, options: { expanded: boolean }) {
  const group = new Container();
  for (const snapshot of snapshots) {
    const card = new SkillInvocationMessageComponent({ ...snapshot, userMessage: "" });
    card.setExpanded(options.expanded);
    group.addChild(card);
  }
  return group;
}
const plain = (component: { render(width: number): string[] }) => component.render(80).map(stripTerminalSequences).join("\n");

function sessionWithDisplay() {
  const session = SessionManager.inMemory(process.cwd());
  const userId = session.appendMessage({ role: "user", content: [{ type: "text", text: payload }], timestamp: 1 });
  const displayId = session.appendCustomEntry(displayType, { userEntryId: userId });
  const entry = session.getEntry(displayId);
  if (!entry || entry.type !== "custom") throw new Error("Expected a custom entry");
  return { session, userId, displayId, entry };
}

test("a public entry renderer can compose two unmodified native skill cards", () => {
  const { entry } = sessionWithDisplay();
  const host = new CustomEntryComponent(entry, renderNativeCards);
  expect(plain(host)).toContain("[skill] research");
  expect(plain(host)).toContain("[skill] adventure");
  expect(plain(host)).not.toContain("RESEARCH_BODY_MARKER");
  expect(plain(host)).not.toContain("ADVENTURE_BODY_MARKER");
  for (const width of [30, 80]) {
    expect(host.render(width).every(line => visibleWidth(line) <= width)).toBe(true);
  }
});

test("host expansion and invalidation propagate to both native cards through renderer options", () => {
  const { entry } = sessionWithDisplay();
  const host = new CustomEntryComponent(entry, renderNativeCards);
  host.setExpanded(true);
  expect(plain(host)).toContain("RESEARCH_BODY_MARKER");
  expect(plain(host)).toContain("ADVENTURE_BODY_MARKER");
  host.invalidate();
  expect(plain(host)).toContain("RESEARCH_BODY_MARKER");
  host.setExpanded(false);
  expect(plain(host)).not.toContain("RESEARCH_BODY_MARKER");
});

test("a derived display entry adds no model message or duplicate skill content", () => {
  const { session, userId, entry } = sessionWithDisplay();
  expect(entry.parentId).toBe(userId);
  const llm = convertToLlm(session.buildSessionContext().messages);
  expect(llm).toHaveLength(1);
  expect(llm[0].role).toBe("user");
  expect(llm[0].content).toEqual([{ type: "text", text: payload }]);
  expect(session.buildContextEntries().map(item => item.type)).toEqual(["message", "custom"]);
});

test("restoring an entry snapshot retains one user payload and two native display cards", () => {
  const { session } = sessionWithDisplay();
  const entries = JSON.parse(JSON.stringify(session.getEntries()));
  const restored = SessionManager.inMemory(process.cwd(), undefined, entries);
  expect(convertToLlm(restored.buildSessionContext().messages)).toHaveLength(1);
  const entry = restored.buildContextEntries().find(item => item.type === "custom");
  if (!entry || entry.type !== "custom") throw new Error("Expected restored display entry");
  const host = new CustomEntryComponent(entry, renderNativeCards);
  expect(plain(host)).toContain("[skill] research");
  expect(plain(host)).toContain("[skill] adventure");
});

test("branching before the derived display preserves model content but omits the display entry", () => {
  const { session, userId } = sessionWithDisplay();
  session.branch(userId);
  expect(convertToLlm(session.buildSessionContext().messages)).toHaveLength(1);
  expect(session.buildContextEntries().some(item => item.type === "custom")).toBe(false);
});
