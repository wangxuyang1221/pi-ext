/** Resolve an explicitly requested budget against optional extension configuration. */
export function resolveGoalBudget(budget, config) {
    if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).some(key => key !== "maxGoalTokenBudget"))
        throw new Error("Invalid goal configuration. Expected an object with optional maxGoalTokenBudget.");
    const maximum = config.maxGoalTokenBudget;
    for (const value of [maximum, budget]) {
        if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0))
            throw new Error("Goal budget and maxGoalTokenBudget must be positive safe integers.");
    }
    if (budget !== undefined && maximum !== undefined && budget > maximum)
        throw new Error(`Goal token budget ${budget} exceeds the maximum allowed goal token budget of ${maximum}.`);
    return budget ?? maximum;
}
//# sourceMappingURL=budget.js.map