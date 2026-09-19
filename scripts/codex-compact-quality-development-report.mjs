// Rebuild the development report without publishing raw histories or credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
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
  if (process.argv[2] === "--chain-evidence") {
    const evidence = JSON.parse(fs.readFileSync(process.argv[3] ?? "docs/fixtures/codex-quality-chain-evidence.json", "utf8"));
    verifyOutput(path.resolve(process.argv[4] ?? "docs/fixtures/codex-quality-chain-results.json"), rebuildChainReport(evidence));
    return;
  }
  if (process.argv[2] === "--evidence") {
    const evidence = JSON.parse(fs.readFileSync(process.argv[3] ?? "docs/fixtures/codex-quality-development-evidence.json", "utf8"));
    verifyOutput(path.resolve(process.argv[4] ?? "docs/fixtures/codex-quality-development-results.json"), rebuildDevelopmentReport(evidence));
    return;
  }
  const root = path.resolve(process.argv[2] ?? ".tmp/codex-quality/development-four-arm-v1");
  const gradesRoot = path.resolve(process.argv[3] ?? ".tmp/codex-quality/development-four-arm-grades-v1");
  const output = path.resolve(process.argv[4] ?? "docs/fixtures/codex-quality-development-results.json");
  const cwd = fs.realpathSync(process.cwd());
  const relativeOutput = path.relative(cwd, fs.realpathSync(path.dirname(output)));
  assert.ok(relativeOutput !== ".." && !relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput), "Output must stay in the repository");
  const fingerprints = {};
  function read(file, label) {
    const bytes = fs.readFileSync(file);
    fingerprints[label] = createHash("sha256").update(bytes).digest("hex");
    return JSON.parse(bytes);
  }
  const config = read(path.join(root, "configuration.json"), "configuration");
  assert.equal(config.track, "development-fixed-boundary");
  assert.equal(config.formalQualityEvidence, false);
  const model = read(path.join(root, "model.json"), "model");
  const grades = read(path.join(gradesRoot, "report.json"), "grades");
  const eventsBytes = fs.readFileSync(path.join(root, "events.jsonl"));
  fingerprints.events = createHash("sha256").update(eventsBytes).digest("hex");
  const events = eventsBytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
  const cli = read(path.join(root, "cli-checkpoint.json"), "cliCheckpoint");
  read(path.join(root, "frozen-module-fingerprints.json"), "frozenModules");
  const armInputs = [];
  const arms = ["old", "new", "cli", "reference"].map(arm => {
    const result = read(path.join(root, arm, "result.json"), `${arm}Result`);
    const compactEvents = events.filter(event => event.arm === arm && event.phase === "compact");
    let compaction = null;
    if (arm === "cli") compaction = { usage: usageCounts(cli.usage.usage, "codex-record"), elapsedMs: null };
    else if (arm !== "reference") {
      assert.equal(compactEvents.length, 1, "Missing or duplicate compaction event");
      compaction = { usage: usageCounts(compactEvents[0].usage, "pi"), elapsedMs: compactEvents[0].elapsedMs };
    }
    const matchingGrades = grades.results.filter(grade => grade.arm === arm);
    assert.equal(matchingGrades.length, 1, "Missing or duplicate grade");
    const publicInput = { arm,
      result: { status: result.status, requests: result.requests, elapsedMs: result.elapsedMs, changedPaths: result.changedPaths, tools: result.tools.map(tool => ({ status: tool.status })) },
      responses: events.filter(event => event.arm === arm && event.phase === "response").map(event => {
        const usage = usageCounts(event.usage, "responses");
        return { request: event.request, usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.total, input_tokens_details: { cached_tokens: usage.cachedInput, cache_write_tokens: usage.cacheWriteInput } } };
      }),
      compaction, rates: model.cost,
      grade: { human_review: matchingGrades[0].human_review, executable: { passed: matchingGrades[0].executable.passed, tests: matchingGrades[0].executable.tests } },
      counterexamples: { baseline: grades.exploratory_counterexamples.results.base, candidate: grades.exploratory_counterexamples.results[arm] }
    };
    armInputs.push(publicInput);
    return summarizeDevelopmentArm(publicInput);
  });
  const report = {
    schemaVersion: 1, status: "development_only", instanceId: grades.instance_id,
    independentTasks: config.independentTasks, formalQualityEvidence: false,
    natural90PercentEvidence: false, baseline: config.baseline, model: model.id, effort: config.effort,
    continuationOrder: config.continuationOrder, inputHistorySha256: config.inputHistorySha256,
    cliRolloutSha256: config.cliRolloutSha256, sourceFingerprints: fingerprints,
    costBasis: "client_model_metadata_not_verified_billing", metadataRates: model.cost,
    cliCompactionLatency: "not_recorded", arms,
    limitations: config.limitations,
    interpretation: "单个开发任务。原有隐藏测试均通过，但事后反例发现新插件、CLI、未压缩组存在原有行为回归。不能据此宣称质量提升，也不能把回归单独归因于压缩。人工盲评尚未完成。"
  };
  const evidence = { schemaVersion: 1, header: { ...report, arms: null }, armInputs };
  assert.deepEqual(rebuildDevelopmentReport(evidence), report);
  verifyOutput(path.join(path.dirname(output), "codex-quality-development-evidence.json"), evidence);
  verifyOutput(output, report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
