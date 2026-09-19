// Explicit usage adapters for the quality comparison report.
export function usageCounts(value, format) {
  let input, cachedInput, cacheWriteInput, output, reportedTotal;
  if (format === "responses") {
    input = value.input_tokens;
    cachedInput = value.input_tokens_details?.cached_tokens ?? 0;
    cacheWriteInput = value.input_tokens_details?.cache_write_tokens ?? 0;
    output = value.output_tokens;
    reportedTotal = value.total_tokens;
  } else if (format === "codex-record") {
    input = value.input_tokens;
    cachedInput = value.cached_input_tokens ?? 0;
    cacheWriteInput = value.cache_write_input_tokens ?? 0;
    output = value.output_tokens;
    reportedTotal = value.total_tokens;
  } else if (format === "pi") {
    cachedInput = value.cacheRead;
    cacheWriteInput = value.cacheWrite;
    for (const count of [value.input, cachedInput, cacheWriteInput]) validateCount(count);
    input = value.input + cachedInput + cacheWriteInput;
    output = value.output;
    reportedTotal = value.totalTokens;
  } else {
    throw new Error(`Unknown usage format: ${format}`);
  }
  for (const count of [input, cachedInput, cacheWriteInput, output]) validateCount(count);
  const uncachedInput = input - cachedInput - cacheWriteInput;
  const total = input + output;
  validateCount(uncachedInput);
  validateCount(total);
  if (reportedTotal !== undefined) {
    validateCount(reportedTotal);
    if (reportedTotal !== total) throw new Error("Inconsistent usage total");
  }
  return { input, uncachedInput, cachedInput, cacheWriteInput, output, total };
}

// Rates are client metadata per million tokens, not independently verified billing.
export function estimateCost(counts, rates) {
  for (const entry of [rates, ...(rates.tiers ?? [])]) {
    for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
      if (!Number.isFinite(entry[key]) || entry[key] < 0) throw new Error("Invalid price metadata");
    }
    if (entry !== rates) validateCount(entry.inputTokensAbove);
  }
  let selected = rates;
  for (const tier of [...(rates.tiers ?? [])].sort((a, b) => a.inputTokensAbove - b.inputTokensAbove)) {
    if (counts.input > tier.inputTokensAbove) selected = tier;
  }
  return (counts.uncachedInput * selected.input + counts.cachedInput * selected.cacheRead
    + counts.cacheWriteInput * selected.cacheWrite + counts.output * selected.output) / 1_000_000;
}

function validateCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid usage count");
}
