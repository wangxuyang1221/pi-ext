export const KINDS = ["spawn", "prompt", "list", "read", "wait", "close"];
export const OUTCOMES = ["success", "error", "timeout", "interrupted", "hold"];

export function fixture(kind, outcome = "success", long = false) {
  const agent = { agentId: "child-lin", name: long ? "Lin-review-rendering-and-terminal-width-handling" : "Lin", status: "running", generation: 2, model: "gpt-5.4", thinkingLevel: "medium", tmuxWindow: "pi-subagents:1" };
  const activity = [
    { kind: "assistant", id: "a1", timestamp: "2026-09-22T10:00:00Z", text: "Reviewed the renderer. All six tool messages keep their existing information.", stopReason: "stop", truncated: false },
    { kind: "tool", id: "t1", timestamp: "2026-09-22T10:00:00Z", toolName: "read", outcome: "succeeded" },
  ];
  const task = "Review subagent rendering and check narrow terminal layouts.";
  const prompt = "Also check the expanded activity view.";
  const args = kind === "spawn" ? { name: agent.name, task, model: agent.model, thinkingLevel: agent.thinkingLevel }
    : kind === "prompt" ? { agentId: agent.agentId, text: prompt, delivery: "steer" }
    : kind === "list" ? {} : kind === "close" ? { target: agent.agentId }
    : kind === "wait" ? { agentId: agent.agentId, timeoutMs: 30000 }
    : { agentId: agent.agentId, view: "recent_activity" };
  const details = { operation: kind, ok: outcome !== "error", agent, task, prompt, delivery: "steer",
    agents: [agent, { ...agent, agentId: "child-chen", name: "Chen", status: "settled" }],
    capacity: { active: 1, pending: 0, limit: 4, available: 3 },
    view: "recent_activity", activity, assistantCount: 1, toolCount: 1, returnedBytes: 384,
    cursor: "cursor-a", durationMs: 1200, outcome: "settled", settledCursor: "cursor-b",
    affected: [{ ...agent, status: "closed" }], relationshipRemoved: true, extensionDataRemoved: true, piSessionRetained: true,
  };
  if (kind === "wait") {
    details.outcome = ["timeout", "interrupted"].includes(outcome) ? outcome : "settled";
    details.agent = { ...agent, status: outcome === "timeout" ? "running" : outcome === "interrupted" ? "interrupted" : "settled" };
  }
  if (kind === "close") details.agent = { ...agent, status: "closed" };
  if (outcome === "error") details.message = "Agent unavailable: the selected session could not be reached.";
  return { args, result: { content: [{ type: "text", text: details.message ?? "Fixture result" }], details } };
}
