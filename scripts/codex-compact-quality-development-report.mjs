// Rebuild the development report without publishing raw histories or credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { usageCounts, estimateCost } from "./codex-compact-quality-metrics.mjs";

function summarizeFailedArm({ arm, result, responses, compaction, rates, grade, counterexamples }) {
  assert.equal(result.status, "failed", "Unsupported incomplete attempt status");
  assert.ok(Number.isSafeInteger(result.requestsAttempted) && result.requestsAttempted >= responses.length, "Invalid attempted request count");
  assert.ok(result.failure && typeof result.failure.message === "string", "Missing attempt failure");
  assert.equal(grade.executable, null, "Failed continuation cannot claim completed evaluation");
  assert.equal(counterexamples, null, "Failed continuation cannot claim completed counterexample evaluation");
  responses.forEach((response, i) => assert.equal(response.request, i, "Duplicate or reordered partial request"));
  const counts = responses.map(response => usageCounts(response.usage, "responses"));
  const recordedUsage = counts.length ? Object.fromEntries(Object.keys(counts[0]).map(key => [key, counts.reduce((sum, count) => sum + count[key], 0)])) : null;
  return { arm, status: "failed", formalQualityEvidence: false, failure: result.failure,
    compaction: compaction && { usage: compaction.usage, elapsedMs: compaction.elapsedMs, estimatedMetadataCost: estimateCost(compaction.usage, rates) },
    continuation: { firstRequestInput: counts[0]?.input ?? null, recordedUsage, usageComplete: false,
      requestsAttempted: result.requestsAttempted, completedResponses: counts.length,
      estimatedMetadataCostLowerBound: counts.reduce((sum, count) => sum + estimateCost(count, rates), 0),
      toolCallsRecorded: result.tools.length },
    executable: { status: "not_evaluated" }, exploratoryCounterexamples: { status: "not_evaluated" }, humanReview: grade.human_review };
}

export function summarizeDevelopmentArm(input) {
  const { arm, result, responses, compaction, rates, grade, counterexamples } = input;
  if (result.status !== "completed") return summarizeFailedArm(input);
  assert.equal(responses.length, result.requests, "Missing response usage");
  assert.ok(responses.length > 0, "Missing first request occupancy");
  responses.forEach((response, i) => assert.equal(response.request, i, "Duplicate or reordered request"));
  const counts = responses.map(response => usageCounts(response.usage, "responses"));
  const cumulativeUsage = Object.fromEntries(Object.keys(counts[0]).map(key => [key, counts.reduce((sum, count) => sum + count[key], 0)]));
  if (grade.executable.passed) {
    const tests = Object.values(grade.executable.tests);
    assert.ok(tests.length > 0 && tests.every(status => status === "passed"), "Contradictory passing grade");
  }
  const probes = Object.keys(counterexamples.baseline);
  assert.deepEqual(Object.keys(counterexamples.candidate).sort(), [...probes].sort(), "Missing counterexample outcomes");
  return {
    arm, status: result.status, formalQualityEvidence: false,
    compaction: compaction && { usage: compaction.usage, elapsedMs: compaction.elapsedMs, estimatedMetadataCost: estimateCost(compaction.usage, rates) },
    continuation: {
      firstRequestInput: counts[0].input, cumulativeUsage,
      estimatedMetadataCost: counts.reduce((sum, count) => sum + estimateCost(count, rates), 0),
      elapsedMs: result.elapsedMs, requests: result.requests,
      toolCalls: result.tools.length, toolErrors: result.tools.filter(tool => tool.status === "error").length,
      changedPaths: result.changedPaths
    },
    executable: { passed: grade.executable.passed, tests: Object.keys(grade.executable.tests).length },
    exploratoryCounterexamples: { preregistered: false, passed: probes.filter(key => isDeepStrictEqual(counterexamples.baseline[key], counterexamples.candidate[key])).length, total: probes.length },
    humanReview: grade.human_review
  };
}

export function rebuildDevelopmentReport(evidence) {
  assert.equal(evidence.schemaVersion, 1, "Unknown development evidence schema");
  assert.equal(evidence.header.formalQualityEvidence, false);
  assert.deepEqual(evidence.armInputs.map(input => input.arm), ["old", "new", "cli", "reference"]);
  return { ...evidence.header, arms: evidence.armInputs.map(summarizeDevelopmentArm) };
}

function summarizeChainPhase(phase, rates) {
  assert.ok(["completed", "failed", "dependency_failed", "not_applicable"].includes(phase.status), "Invalid chain phase status");
  assert.ok(Array.isArray(phase.responses), "Missing chain response evidence");
  assert.ok(phase.requestsAttempted === null || (Number.isSafeInteger(phase.requestsAttempted) && phase.requestsAttempted >= phase.responses.length), "Invalid chain request count");
  if (["dependency_failed", "not_applicable"].includes(phase.status)) {
    assert.equal(phase.requestsAttempted, 0); assert.equal(phase.responses.length, 0);
  }
  if (phase.status === "completed") assert.ok(phase.responses.length > 0, "Missing completed chain response usage");
  const counts = phase.responses.map(usage => usageCounts(usage, "responses"));
  assert.ok(phase.elapsedMs === null || (Number.isFinite(phase.elapsedMs) && phase.elapsedMs >= 0), "Invalid chain phase duration");
  return { status: phase.status, requestsAttempted: phase.requestsAttempted, completedResponses: counts.length,
    firstRequestInput: counts[0]?.input ?? null,
    recordedUsage: counts.length ? Object.fromEntries(Object.keys(counts[0]).map(key => [key, counts.reduce((sum, count) => sum + count[key], 0)])) : null,
    usageComplete: phase.status === "not_applicable" || (phase.status === "completed" && phase.requestsAttempted === counts.length),
    estimatedMetadataCostLowerBound: counts.reduce((sum, count) => sum + estimateCost(count, rates), 0), elapsedMs: phase.elapsedMs,
    ...(phase.failure ? { failure: phase.failure } : {}) };
}

/** Rebuilds one development task's longitudinal results without treating its cycles as independent samples. */
export function rebuildChainReport(evidence) {
  assert.equal(evidence.schemaVersion, 1, "Unknown chain evidence schema");
  assert.equal(evidence.header.formalQualityEvidence, false);
  assert.equal(evidence.header.independentTasks, 1, "A chain report describes one task, not independent cycles");
  assert.equal(evidence.header.track, "development-compaction-chain");
  assert.ok(Number.isSafeInteger(evidence.header.compactionCycles) && evidence.header.compactionCycles >= 2);
  assert.deepEqual(evidence.armInputs.map(input => input.arm), ["old", "new", "cli", "reference"]);
  const arms = evidence.armInputs.map(input => {
    assert.equal(input.stages.length, evidence.header.compactionCycles, "Missing chain stages");
    const stages = input.stages.map((stage, cycle) => {
      assert.equal(stage.cycle, cycle, "Changed cycle ordering");
      assert.equal(stage.humanReview, "pending", "Human results need a separately validated review record");
      assert.equal(stage.compaction.status === "not_applicable", input.arm === "reference", "Reference must not compact");
      assert.notEqual(stage.continuation.status, "not_applicable", "Every cycle has a continuation opportunity");
      const compaction = summarizeChainPhase(stage.compaction, evidence.rates);
      const continuation = summarizeChainPhase(stage.continuation, evidence.rates);
      const checks = stage.checks;
      assert.equal(typeof checks.scopePassed, "boolean");
      if (checks.hiddenTests !== null) {
        assert.equal(typeof checks.hiddenTests.passed, "boolean");
        assert.ok(Number.isSafeInteger(checks.hiddenTests.count) && checks.hiddenTests.count > 0);
      }
      if (continuation.status !== "completed") {
        assert.equal(checks.hiddenTests, null, "Failed continuation cannot claim completed evaluation");
        assert.equal(checks.compatibilityGuardsPassed, null);
      }
      const automatedPassed = ["completed", "not_applicable"].includes(compaction.status) && continuation.status === "completed"
        && checks.scopePassed && (cycle === 0 ? checks.workspaceUnchanged === true : checks.hiddenTests?.passed === true && checks.compatibilityGuardsPassed === true);
      return { cycle, compaction, continuation, checks, automatedPassed, humanReview: "pending" };
    });
    const phases = stages.flatMap(stage => [stage.compaction, stage.continuation]);
    return { arm: input.arm, stages, completedResponses: phases.reduce((sum, phase) => sum + phase.completedResponses, 0),
      usageComplete: phases.every(phase => phase.usageComplete),
      estimatedMetadataCostLowerBound: phases.reduce((sum, phase) => sum + phase.estimatedMetadataCostLowerBound, 0),
      automatedPassed: stages.every(stage => stage.automatedPassed), sessionSuccess: null, humanReview: "pending" };
  });
  return { ...evidence.header, arms };
}

function verifyOutput(output, value) {
  const cwd = fs.realpathSync(process.cwd());
  const relativeOutput = path.relative(cwd, fs.realpathSync(path.dirname(output)));
  assert.ok(relativeOutput !== ".." && !relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput), "Output must stay in the repository");
  const serialized = JSON.stringify(value, null, 2) + "\n";
  // Refuse symlinks and divergent existing reports; exact rebuilds need no write.
  if (fs.existsSync(output)) {
    assert.ok(fs.lstatSync(output).isFile() && !fs.lstatSync(output).isSymbolicLink(), "Invalid report destination");
    assert.equal(fs.readFileSync(output, "utf8"), serialized, "Existing report differs; choose a new output path");
  } else fs.writeFileSync(output, serialized, { flag: "wx" });
  console.log(`Development report verified: ${path.relative(cwd, output)}`);
}

function main() {
  const [mode, input, output, ...extra] = process.argv.slice(2);
  if (!["--evidence", "--chain-evidence"].includes(mode) || !input || !output || extra.length) {
    console.error("Usage: pnpm run codex-compact:quality:report <--evidence|--chain-evidence> <evidence.json> <output.json>");
    process.exitCode = 1;
    return;
  }
  const evidence = JSON.parse(fs.readFileSync(input, "utf8"));
  const rebuild = mode === "--chain-evidence" ? rebuildChainReport : rebuildDevelopmentReport;
  verifyOutput(path.resolve(output), rebuild(evidence));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
