import { expect, it } from "vitest";
import { GoalLoopDetector, LOOP_WINDOW } from "../src/loop.js";
const read = (path = "report.md", text = "Verified report") => ({ toolName: "read", input: { path }, content: [{ type: "text", text }], isError: false });
it("warns once after four repeated observations and pauses after eight without requiring a run to end", () => {
  const detector = new GoalLoopDetector();
  const decisions = Array.from({ length: 9 }, () => detector.observe(read()));
  expect(decisions.slice(0, 4)).toEqual(Array(4).fill("none"));
  expect(decisions[4]).toBe("warn");
  expect(decisions.slice(5, 8)).toEqual(Array(3).fill("none"));
  expect(decisions[8]).toBe("pause");
});
it("canonicalizes arguments while treating genuinely different results as different observations", () => {
  const detector = new GoalLoopDetector();
  for (let i = 0; i < 4; i++) expect(detector.observe({ ...read(), input: { path: "report.md", offset: 1 } })).toBe("none");
  expect(detector.observe({ ...read(), input: { offset: 1, path: "report.md" } })).toBe("warn");
  expect(detector.observe(read("report.md", "New evidence"))).toBe("none");
  expect(detector.state.repeats).toBe(0);
});
it("bounds retained history and declines oversized or cyclic evidence instead of matching a truncated prefix", () => {
  const detector = new GoalLoopDetector();
  for (let i = 0; i < 178; i++) expect(detector.observe(read(`file-${i}`))).toBe("none");
  expect(detector.state.retained).toBe(LOOP_WINDOW);
  for (let i = 0; i < 20; i++) expect(detector.observe(read("large", "x".repeat(200_000)))).toBe("none");
  const circular: any = {}; circular.self = circular;
  expect(() => detector.observe({ ...read(), input: circular })).not.toThrow();
  expect(detector.state).toEqual({ retained: 0, repeats: 0 });
});
it("detects alternating and irregular short sequences without treating successful writes as progress", () => {
  const detector = new GoalLoopDetector();
  const write = { ...read(), toolName: "write" };
  const sequence = [read(), write, read(), read(), write];
  const results = Array.from({ length: 30 }, (_, i) => detector.observe(sequence[i % sequence.length]!));
  expect(results.filter(result => result === "warn")).toHaveLength(1);
  expect(results).toContain("pause");
  detector.reset();
  expect(detector.observe(read())).toBe("none");
});
it("exempts only live matching subagent wait receipts, not terminal results or textual claims", () => {
  const wait = (status: string, agentId = "child", outcome = "timeout") => ({
    toolName: "subagent_wait", input: { agentId: "child" }, isError: false,
    content: [{ type: "text", text: JSON.stringify({ outcome, agent: { agentId, status } }) }],
  });
  const detector = new GoalLoopDetector();
  for (let i = 0; i < 40; i++) expect(detector.observe(wait("running"))).toBe("none");
  expect(detector.state.repeats).toBe(0);
  for (const observation of [wait("settled", "child", "settled"), wait("running", "other"), read("state.json", "running")]) {
    detector.reset();
    expect(Array.from({ length: 17 }, () => detector.observe(observation))).toContain("pause");
  }
});
it("leaves failed tool handling to existing failure rules and permits new research evidence", () => {
  const detector = new GoalLoopDetector();
  for (let i = 0; i < 40; i++) {
    expect(detector.observe({ ...read(), isError: true })).toBe("none");
    expect(detector.observe(read("report.md", `Evidence ${i}`))).toBe("none");
  }
});
