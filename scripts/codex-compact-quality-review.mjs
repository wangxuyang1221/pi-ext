// Prepare development review material; human ratings are never generated here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dimensions = ["task_alignment", "factual_omissions", "unsupported_claims", "stale_conclusions", "constraint_violations", "unnecessary_reinvestigation"];

function files(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Missing review source files");
  for (const [name, content] of Object.entries(value)) {
    assert.ok(name && !name.startsWith("/") && !name.includes("\\") && name.split("/").every(part => part && part !== "." && part !== ".."), "Invalid review file path");
    assert.equal(typeof content, "string", "Review source must be text");
  }
  return structuredClone(value);
}

export function prepareBlindReview({ seed, task, sources, candidates, historicalContext = "" }) {
  assert.ok(typeof seed === "string" && seed.length >= 16, "A private allocation seed is required");
  assert.ok(typeof task === "string" && task.trim(), "Missing review task");
  assert.equal(typeof historicalContext, "string", "Invalid review context");
  assert.deepEqual(candidates.map(candidate => candidate.arm).sort(), ["cli", "new", "old", "reference"], "Exactly four distinct conditions are required");
  const allocation = { seed, candidates: {} };
  const anonymized = candidates.map(candidate => {
    const id = "C-" + hash([seed, "candidate", candidate.arm]).slice(0, 16);
    assert.ok(!allocation.candidates[id], "Duplicate candidate code");
    allocation.candidates[id] = candidate.arm;
    assert.equal(typeof candidate.answer, "string", "Missing candidate answer");
    if (candidate.workspacePath !== undefined) assert.ok(typeof candidate.workspacePath === "string" && candidate.workspacePath.startsWith("/") && candidate.workspacePath.length > 1, "Invalid private workspace root");
    const redact = text => candidate.workspacePath ? text.replaceAll(candidate.workspacePath, "<workspace>") : text;
    const toolEvents = candidate.toolEvents.map(event => {
      assert.ok(["read_file", "replace_text"].includes(event.name), "Unsupported review tool");
      assert.ok(["ok", "error"].includes(event.status), "Invalid review tool status");
      const args = { path: event.arguments.path };
      assert.equal(typeof args.path, "string", "Missing reviewed tool path");
      if (event.name === "replace_text") {
        assert.equal(typeof event.arguments.old_text, "string", "Missing replacement source");
        assert.equal(typeof event.arguments.new_text, "string", "Missing replacement result");
        args.old_text = event.arguments.old_text; args.new_text = event.arguments.new_text;
      }
      args.path = redact(args.path);
      return { name: event.name, arguments: args, status: event.status, ...(event.message ? { message: redact(String(event.message)) } : {}) };
    });
    return { id, answer: redact(candidate.answer), files: files(candidate.files), toolEvents };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const reviewers = ["R1", "R2"].map(slot => {
    const order = anonymized.map(candidate => candidate.id).sort((a, b) => hash([seed, slot, a]).localeCompare(hash([seed, slot, b])));
    return { slot, reviewerIdentity: null, confirmedHuman: false, order, forms: order.map(id => ({ candidateId: id,
      ratings: Object.fromEntries(dimensions.map(name => [name, null])), evidence: {}, rationale: null })) };
  });
  return { packet: { schemaVersion: 1, stage: "development_rubric_trial", origin: "ai_generated_candidates", humanReview: "pending",
    task, historicalContext, sources: files(sources), candidates: anonymized, reviewers }, allocation };
}
