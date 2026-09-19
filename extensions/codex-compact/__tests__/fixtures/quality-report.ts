// Synthetic arithmetic fixtures, not historical quality evidence.
const arms = ["old", "new", "cli", "reference"];
const rates = { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 };
const header = { schemaVersion: 1, formalQualityEvidence: false, synthetic: true };

export function developmentEvidence() {
  return { schemaVersion: 1, header: { ...header }, armInputs: arms.map(arm => ({
    arm,
    result: { status: "completed", requests: 2, elapsedMs: 20, changedPaths: ["example.ts"], tools: [{ status: "error" }] },
    responses: [0, 1].map(request => ({ request, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 50 } } })),
    compaction: null, rates: { ...rates },
    grade: { human_review: "pending", executable: { passed: true, tests: { synthetic: "passed" } } },
    counterexamples: { baseline: { probe: { value: "" } }, candidate: { probe: { error: "ValueError" } } },
  })) };
}

export function developmentReport() {
  return { ...header, arms: arms.map(arm => ({
    arm, status: "completed", formalQualityEvidence: false, compaction: null,
    continuation: {
      firstRequestInput: 100,
      cumulativeUsage: { input: 200, uncachedInput: 100, output: 20, total: 220, cachedInput: 100, cacheWriteInput: 0 },
      estimatedMetadataCost: 0.00115, elapsedMs: 20, requests: 2,
      toolCalls: 1, toolErrors: 1, changedPaths: ["example.ts"],
    },
    executable: { passed: true, tests: 1 },
    exploratoryCounterexamples: { preregistered: false, passed: 0, total: 1 }, humanReview: "pending",
  })) };
}

const chainHeader = { ...header, independentTasks: 1, compactionCycles: 2, track: "development-compaction-chain" };
const checks = { scopePassed: true, workspaceUnchanged: true, hiddenTests: { passed: true, count: 1 }, compatibilityGuardsPassed: true };

export function chainEvidence() {
  const phase = () => ({ status: "completed", requestsAttempted: 1, responses: [{ input_tokens: 100, output_tokens: 10, total_tokens: 110 }], elapsedMs: 20 });
  return { schemaVersion: 1, header: { ...chainHeader }, rates: { ...rates }, armInputs: arms.map(arm => ({
    arm, stages: [0, 1].map(cycle => ({ cycle,
      compaction: arm === "reference" ? { status: "not_applicable", requestsAttempted: 0, responses: [], elapsedMs: 0 } : phase(),
      continuation: phase(), checks: structuredClone(checks), humanReview: "pending",
    })),
  })) };
}

export function chainReport() {
  const phase = () => ({ status: "completed", requestsAttempted: 1, completedResponses: 1, firstRequestInput: 100,
    recordedUsage: { input: 100, uncachedInput: 100, output: 10, total: 110, cachedInput: 0, cacheWriteInput: 0 },
    usageComplete: true, estimatedMetadataCostLowerBound: 0.0008, elapsedMs: 20 });
  return { ...chainHeader, arms: arms.map(arm => ({ arm,
    stages: [0, 1].map(cycle => ({ cycle,
      compaction: arm === "reference" ? { status: "not_applicable", requestsAttempted: 0, completedResponses: 0, firstRequestInput: null, recordedUsage: null, usageComplete: true, estimatedMetadataCostLowerBound: 0, elapsedMs: 0 } : phase(),
      continuation: phase(), checks: structuredClone(checks), automatedPassed: true, humanReview: "pending",
    })),
    completedResponses: arm === "reference" ? 2 : 4, usageComplete: true,
    estimatedMetadataCostLowerBound: arm === "reference" ? 0.0016 : 0.0032,
    automatedPassed: true, sessionSuccess: null, humanReview: "pending",
  })) };
}

export function pilotAudit() {
  return {
    candidateCount: 3, parseablePrefixes: 2, maxLocalEstimatedTokens: 120, medianLocalEstimatedTokens: 120,
    parseStops: 1, completePairSequences: 1, locallyAtOrAboveThreshold: 1, localThreshold: 100,
    columnsRead: ["instance_id", "trajectory"], outcomeColumnsRead: [], pilotModelEvaluations: 0,
    holdoutTrajectoriesExported: 0, server90PercentValidated: 0, formalQualityEvidence: false, answerLeakageReview: "pending",
    records: [
      { instanceId: "one", sourceMessages: 4, longestImportablePrefix: { sourceMessages: 3, localEstimatedTokens: 50 } },
      { instanceId: "two", sourceMessages: 5, longestImportablePrefix: { sourceMessages: 2, localEstimatedTokens: 120 }, firstFailure: "synthetic" },
      { instanceId: "three", sourceMessages: 1 },
    ].map(row => ({ ...row, serverUsage: null, natural90PercentEvidence: false, workspaceReplay: "not_validated" })),
  };
}
