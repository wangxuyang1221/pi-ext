import { expect, test } from "vitest";
import * as report from "../../../scripts/codex-compact-quality-development-report.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertSafePublishedPath } from "../../../scripts/package-paths.mjs";
import { chainEvidence, chainReport, developmentEvidence, developmentReport, pilotAudit } from "./fixtures/quality-report.js";

test("keeps compaction cycles inside one task and reports unknown retry usage as a lower bound", () => {
  const phase = () => ({ status: "completed", requestsAttempted: 1, responses: [{ input_tokens: 100, output_tokens: 10, total_tokens: 110 }], elapsedMs: 20 });
  const evidence = { schemaVersion: 1, header: { formalQualityEvidence: false, independentTasks: 1, compactionCycles: 3, track: "development-compaction-chain" },
    rates: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    armInputs: ["old", "new", "cli", "reference"].map(arm => ({ arm, stages: [0, 1, 2].map(cycle => ({ cycle,
      compaction: arm === "reference" ? { status: "not_applicable", requestsAttempted: 0, responses: [], elapsedMs: 0 } : { ...phase(), requestsAttempted: arm === "cli" ? null : 1 },
      continuation: phase(), checks: { scopePassed: true, workspaceUnchanged: cycle === 0 ? true : null,
        hiddenTests: cycle === 0 ? null : { passed: true, count: 18 }, compatibilityGuardsPassed: cycle === 0 ? null : true }, humanReview: "pending"
    })) })) };
  const built = report.rebuildChainReport(evidence);
  expect(built.independentTasks).toBe(1);
  expect(built.arms[1].completedResponses).toBe(6);
  expect(built.arms[1].usageComplete).toBe(true);
  expect(built.arms[1].estimatedMetadataCostLowerBound).toBeCloseTo(0.0048);
  expect(built.arms[2].usageComplete).toBe(false);
  expect(built.arms[2].estimatedMetadataCostLowerBound).toBeGreaterThan(0);
  expect(built.arms[3].completedResponses).toBe(3);
  expect(built.arms.every((arm: any) => arm.automatedPassed && arm.sessionSuccess === null)).toBe(true);
  const failed = structuredClone(evidence);
  failed.armInputs[1].stages[2].continuation.status = "failed";
  failed.armInputs[1].stages[2].continuation.requestsAttempted = 2;
  failed.armInputs[1].stages[2].checks = { scopePassed: false, workspaceUnchanged: null, hiddenTests: null, compatibilityGuardsPassed: null };
  const failure = report.rebuildChainReport(failed).arms[1];
  expect(failure.automatedPassed).toBe(false); expect(failure.usageComplete).toBe(false);
  expect(failure.stages[2].continuation.requestsAttempted).toBe(2);
  expect(failure.stages[2].continuation.completedResponses).toBe(1);
  for (const mutate of [(value: any) => value.armInputs[0].stages.pop(), (value: any) => value.armInputs[1].arm = "old",
    (value: any) => value.armInputs[0].stages[1].cycle = 0, (value: any) => value.header.independentTasks = 3,
    (value: any) => value.armInputs[0].stages[1].humanReview = "passed",
    (value: any) => value.armInputs[0].stages[1].continuation.requestsAttempted = 0,
    (value: any) => { value.armInputs[0].stages[1].continuation.requestsAttempted = 0; value.armInputs[0].stages[1].continuation.responses = []; }]) {
    const invalid = structuredClone(evidence); mutate(invalid); expect(() => report.rebuildChainReport(invalid)).toThrow();
  }
});

test("reports first request occupancy separately from cumulative usage and keeps regressions visible", () => {
  expect(typeof report.summarizeDevelopmentArm).toBe("function");
  const result = report.summarizeDevelopmentArm({
    arm: "new", result: { status: "completed", requests: 2, elapsedMs: 20, changedPaths: ["zarr/util.py"], tools: [{ status: "error" }] },
    responses: [0, 1].map(request => ({ request, usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 50 }, output_tokens: 10, total_tokens: 110 } })),
    compaction: null, rates: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    grade: { human_review: "pending", executable: { passed: true, tests: { a: "passed" } } },
    counterexamples: { baseline: { probe: { value: "" } }, candidate: { probe: { error: "ValueError" } } }
  });
  expect(result.continuation.firstRequestInput).toBe(100);
  expect(result.continuation.cumulativeUsage.input).toBe(200);
  expect(result.continuation.estimatedMetadataCost).toBeCloseTo(0.00115, 12);
  expect(result.continuation.toolErrors).toBe(1);
  expect(result.executable).toEqual({ passed: true, tests: 1 });
  expect(result.exploratoryCounterexamples).toEqual({ preregistered: false, passed: 0, total: 1 });
  expect(result.humanReview).toBe("pending");
  expect(result.formalQualityEvidence).toBe(false);
});

test("keeps failed attempts and partial usage without treating missing evaluation as a passing or zero-cost run", () => {
  const original = developmentEvidence();
  const input = structuredClone(original.armInputs[0]);
  input.result.status = "failed";
  input.result.requestsAttempted = input.responses.length + 1;
  input.result.failure = { name: "TypeError", message: "fetch failed" };
  input.grade = { human_review: "pending", executable: null };
  input.counterexamples = null;
  const failed = report.summarizeDevelopmentArm(input);
  expect(failed.status).toBe("failed");
  expect(failed.continuation.usageComplete).toBe(false);
  expect(failed.continuation.completedResponses).toBe(input.responses.length);
  expect(failed.continuation.requestsAttempted).toBe(input.responses.length + 1);
  expect(failed.continuation.estimatedMetadataCostLowerBound).toBeGreaterThan(0);
  expect(failed.executable).toEqual({ status: "not_evaluated" });
  expect(failed.exploratoryCounterexamples).toEqual({ status: "not_evaluated" });
  expect(failed.failure.message).toBe("fetch failed");
  input.grade.executable = { passed: true, tests: { hidden: "passed" } };
  expect(() => report.summarizeDevelopmentArm(input)).toThrow(/evaluation/);
});

test("rebuilds a synthetic report without historical evidence or private session files", () => {
  const evidence = developmentEvidence();
  expect(report.rebuildDevelopmentReport(evidence)).toEqual(developmentReport());
  const serialized = JSON.stringify(evidence);
  for (const key of ["encrypted_content", "apiKey", "access_token", "refresh_token", "attribution", "workspaceFingerprint"]) expect(serialized).not.toContain(`\"${key}\"`);
});

test("rebuilds the longitudinal development report without raw checkpoint or session data", () => {
  const evidence = chainEvidence();
  expect(report.rebuildChainReport(evidence)).toEqual(chainReport());
  const serialized = JSON.stringify(evidence);
  for (const key of ["encrypted_content", "apiKey", "access_token", "refresh_token", "workspacePath", "workspaceFingerprint"])
    expect(serialized).not.toContain(`"${key}"`);
});

test("keeps pilot structural candidates separate from evaluated quality or server-threshold samples", () => {
  const audit = pilotAudit();
  const tokens = audit.records.filter((row: any) => row.longestImportablePrefix).map((row: any) => row.longestImportablePrefix.localEstimatedTokens).sort((a: number, b: number) => a - b);
  expect(audit.records).toHaveLength(audit.candidateCount);
  expect(new Set(audit.records.map((row: any) => row.instanceId)).size).toBe(audit.candidateCount);
  expect(audit.candidateCount).toBe(3);
  expect(audit.parseablePrefixes).toBe(tokens.length);
  expect(audit.maxLocalEstimatedTokens).toBe(tokens.at(-1));
  expect(audit.medianLocalEstimatedTokens).toBe(tokens[Math.floor(tokens.length / 2)]);
  expect(audit.parseStops).toBe(audit.records.filter((row: any) => row.firstFailure).length);
  expect(audit.completePairSequences).toBe(audit.records.filter((row: any) => row.longestImportablePrefix?.sourceMessages === row.sourceMessages - 1).length);
  expect(audit.locallyAtOrAboveThreshold).toBe(tokens.filter((value: number) => value >= audit.localThreshold).length);
  expect(audit.columnsRead).toEqual(["instance_id", "trajectory"]);
  expect(audit.outcomeColumnsRead).toEqual([]);
  expect(audit.pilotModelEvaluations).toBe(0);
  expect(audit.holdoutTrajectoriesExported).toBe(0);
  expect(audit.server90PercentValidated).toBe(0);
  expect(audit.formalQualityEvidence).toBe(false);
  expect(audit.answerLeakageReview).toBe("pending");
  expect(audit.records.every((row: any) => row.serverUsage === null && row.natural90PercentEvidence === false && row.workspaceReplay === "not_validated")).toBe(true);
});

test("keeps the package allowlist consistent with the fixture and log exclusion policy", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const name of pkg.files) expect(() => assertSafePublishedPath(name)).not.toThrow();
  for (const name of pkg.files.filter((name: string) => name.startsWith("docs/codex"))) {
    expect(fs.existsSync(name)).toBe(true);
  }
  for (const name of ["docs/fixtures/evidence.json", "extensions/x/__tests__/case.ts", "docs/LOGS/output.txt", "docs/run.jsonl", "docs/test-fixture.json"]) {
    expect(() => assertSafePublishedPath(name)).toThrow(/must not be published/);
  }
});

test.each(["--evidence", "--chain-evidence"])("requires explicit archive evidence and refuses divergent reports: %s", (mode) => {
  fs.mkdirSync(".tmp", { recursive: true });
  const directory = fs.mkdtempSync(path.resolve(".tmp/quality-report-"));
  const evidence = path.join(directory, "evidence.json");
  const output = path.join(directory, "report.json");
  const run = () => spawnSync(process.execPath, ["scripts/codex-compact-quality-development-report.mjs", mode, evidence, output], { encoding: "utf8" });
  try {
    expect(run().status).not.toBe(0);
    expect(fs.existsSync(output)).toBe(false);
    fs.writeFileSync(evidence, JSON.stringify(mode === "--evidence" ? developmentEvidence() : chainEvidence()));
    expect(run().status).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual(mode === "--evidence" ? developmentReport() : chainReport());
    expect(run().status).toBe(0);
    fs.writeFileSync(output, "{}");
    expect(run().status).not.toBe(0);
    expect(fs.readFileSync(output, "utf8")).toBe("{}");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects missing requests, duplicated arms, missing probes and contradictory passing grades", () => {
  const original = developmentEvidence();
  for (const mutate of [
    (value: any) => value.armInputs[0].responses.pop(),
    (value: any) => value.armInputs[1].arm = "old",
    (value: any) => delete value.armInputs[0].counterexamples.candidate.probe,
    (value: any) => value.armInputs[0].grade.executable.tests.synthetic = "failed",
  ]) {
    const evidence = structuredClone(original); mutate(evidence);
    expect(() => report.rebuildDevelopmentReport(evidence)).toThrow();
  }
});
