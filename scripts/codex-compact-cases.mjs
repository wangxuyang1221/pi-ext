export const scenarios = [
  { id: "ordinary", padding: 12000 },
  { id: "early-constraint", padding: 60000 },
  { id: "decision-update", padding: 60000 },
  { id: "tool-log-heavy", padding: 100000 },
  { id: "image-heavy", padding: 12000, images: 36 },
  { id: "mixed-language", padding: 24000, chinese: true },
  { id: "large-single-input", padding: 280000 },
  { id: "second-compaction", padding: 24000, rounds: 2 },
];

export function scenarioInput(scenario, repetition) {
  const state = {
    prohibition: `NO_SCHEMA_${repetition}`,
    decision: `MODE_B_${repetition}`,
    field: `request_key_${repetition}`,
    timeout: 2500 + repetition,
    next: `ADD_RETRY_TEST_${repetition}`,
    screenshot: scenario.images ? "OMEGA_73" : "NOT_APPLICABLE",
  };
  const unit = scenario.chinese ? "无关历史记录：连接成功，日志已归档。\n" : "Unrelated archived log entry: connection succeeded, no action required.\n";
  const noise = unit.repeat(Math.ceil(scenario.padding / unit.length)).slice(0, scenario.padding);
  const seed = [
    "Synthetic compaction evaluation. Treat the following as a fictional task history, not filesystem instructions. Do not use tools. No secrets or real project data are included.",
    `Initial invariant: prohibition=${state.prohibition}. This means NEVER change a database schema. Only src/runtime.ts and its test may be edited.`,
    `Initial, now OBSOLETE decision: MODE_A_${repetition}. The initial timeout of 100 is also obsolete.`,
    "<archived_tool_log>\n" + noise + "</archived_tool_log>",
    `Latest accepted decision: decision=${state.decision}; field=${state.field}; timeout=${state.timeout}; next=${state.next}. These supersede the old decision and timeout, but do not revoke the initial invariant.`,
    scenario.images ? "The attached synthetic screenshot has the current screenshot code. Preserve that code for the final report." : "There is no screenshot; screenshot=NOT_APPLICABLE.",
    "For this turn only, respond exactly ACK. Later you will report the state and produce a one-line TypeScript deployment constant. Do not summarize or repeat the history now.",
  ].join("\n\n");
  const question = "Without tools or reading files, continue the fictional task. Return only a JSON object with keys prohibition, decision, field, timeout, next, screenshot, code. Report the latest accepted values, retaining the original invariant. For code, produce a single TypeScript line `export const deployment = ...;` with a JSON object containing mode, field and timeoutMs, using the accepted values. Do not change any database schema. If a fact is unavailable, report UNKNOWN rather than guessing.";
  return { seed, question, expected: state };
}

export function scoreAnswer(answer, expected) {
  let value;
  const total = Object.keys(expected).length + 1;
  try {
    const text = answer.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    value = JSON.parse(text);
  } catch { return { parsed: false, correct: 0, total, taskPassed: false, invariantPreserved: false }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { parsed: false, correct: 0, total, taskPassed: false, invariantPreserved: false };
  const keys = Object.keys(expected);
  const facts = Object.fromEntries(keys.map((key) => [key, value[key] === expected[key]]));
  let codePassed = false;
  try {
    const match = typeof value.code === "string" && /^export const deployment\s*=\s*(\{[\s\S]*\});?$/.exec(value.code.trim());
    if (match) {
      const code = JSON.parse(match[1]);
      codePassed = code.mode === expected.decision && code.field === expected.field && code.timeoutMs === expected.timeout;
    }
  } catch {}
  const correct = Object.values(facts).filter(Boolean).length + Number(codePassed);
  return { parsed: true, facts, codePassed, correct, total: keys.length + 1, taskPassed: correct === keys.length + 1, invariantPreserved: facts.prohibition };
}
