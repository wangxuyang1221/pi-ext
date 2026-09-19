"""Conservative paired inference with independent sessions as the sampling unit.

Methods and derivation: docs/codex-compact-quality-methods.md.
This module does not choose margins, sample sizes, or release requirements.
"""

import math

import numpy as np
from scipy.stats import beta, binom


def _counts(positive, negative, n):
    for value in (positive, negative, n):
        if type(value) is not int:
            raise ValueError("Counts must be integers, not booleans or rounded values.")
    if n < 1 or min(positive, negative) < 0 or positive + negative > n:
        raise ValueError("Invalid paired counts.")


def _probability(value, name, *, open_interval=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite probability.")
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{name} must be a finite probability.")
    if open_interval and value in (0, 1):
        raise ValueError(f"{name} must be strictly between zero and one.")


def _lower(x, n, tail):
    return 0.0 if x == 0 else float(beta.ppf(tail, x, n - x + 1))


def _upper(x, n, tail):
    return 1.0 if x == n else float(beta.isf(tail, x + 1, n - x))


def absolute_interval(successes, n, confidence=0.95):
    """Return a two-sided Clopper-Pearson interval for absolute task success."""
    _counts(successes, 0, n)
    _probability(confidence, "confidence", open_interval=True)
    tail = (1 - confidence) / 2
    return _lower(successes, n, tail), _upper(successes, n, tail)


def paired_lower_bound(positive, negative, n, alpha):
    """Return a one-sided bound using the caller's allocated comparison error."""
    _counts(positive, negative, n)
    _probability(alpha, "alpha", open_interval=True)
    return _lower(positive, n, alpha / 2) - _upper(negative, n, alpha / 2)


def paired_summary(rows, candidate, comparator, *, repeats, alpha, threshold):
    """Aggregate fixed repeats within each independent task, then compare tasks.

    All prespecified repeats must pass. This endpoint is deliberately explicit:
    callers must freeze this rule before gathering confirmatory outcomes. Missing
    records and duplicate records are errors, not exclusions or extra samples.
    """
    if not repeats or any(type(r) is not int or r < 0 for r in repeats) or len(set(repeats)) != len(repeats):
        raise ValueError("Specify distinct nonnegative repeat identifiers.")
    if not candidate or not comparator or candidate == comparator:
        raise ValueError("Specify distinct candidate and comparator arms.")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not -1 <= threshold <= 1:
        raise ValueError("Threshold must be a finite risk difference.")
    grouped = {}
    for row in rows:
        identity, repeat = row.get("independence_id"), row.get("repeat")
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError("Every observation needs an independent-task identity.")
        if type(repeat) is not int or repeat not in repeats:
            raise ValueError("Unexpected repeat identifier.")
        group = grouped.setdefault(identity, {})
        if repeat in group:
            raise ValueError("Duplicate independent-task/repeat record.")
        outcomes = row.get("outcomes", {})
        if any(type(outcomes.get(arm)) is not bool for arm in (candidate, comparator)):
            raise ValueError("Outcomes must be explicit booleans for both arms.")
        group[repeat] = (outcomes[candidate], outcomes[comparator])
    if not grouped:
        raise ValueError("No independent tasks to analyze.")
    pairs = []
    for group in grouped.values():
        if set(group) != set(repeats):
            raise ValueError("Missing prespecified repeat; do not discard failures.")
        pairs.append((all(pair[0] for pair in group.values()),
                      all(pair[1] for pair in group.values())))
    n = len(pairs)
    positive = sum(a and not b for a, b in pairs)
    negative = sum(b and not a for a, b in pairs)
    bound = paired_lower_bound(positive, negative, n, alpha)
    return {
        "n": n, "candidate": candidate, "comparator": comparator,
        "candidate_successes": sum(a for a, _ in pairs),
        "comparator_successes": sum(b for _, b in pairs),
        "candidate_interval95": absolute_interval(sum(a for a, _ in pairs), n),
        "comparator_interval95": absolute_interval(sum(b for _, b in pairs), n),
        "positive": positive, "negative": negative,
        "difference": (positive - negative) / n,
        "interval95": paired_interval(positive, negative, n),
        "allocated_alpha": alpha, "lower_bound": bound,
        "threshold": threshold, "passes_threshold": bound > threshold,
        "aggregation": "all_prespecified_repeats_pass", "repeats": list(repeats),
    }


def paired_power(n, p_positive, p_negative, threshold, alpha):
    """Sum the exact multinomial rejection region using conditional binomials.

    Conditional on b, c is Binomial(n-b, p_negative/(1-p_positive)).
    Monotone upper confidence limits permit a vectorized search for the last
    accepted c. No simulation error, quadratic enumeration, or normal
    approximation is introduced.
    """
    _counts(0, 0, n)
    _probability(p_positive, "p_positive")
    _probability(p_negative, "p_negative")
    _probability(alpha, "alpha", open_interval=True)
    if p_positive + p_negative > 1:
        raise ValueError("Discordance probabilities must sum to at most one.")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not -1 <= threshold <= 1:
        raise ValueError("Threshold must be a finite risk difference.")
    if p_positive == 1:
        return float(paired_lower_bound(n, 0, n, alpha) > threshold)
    counts = np.arange(n + 1)
    lower = np.zeros(n + 1)
    upper = np.ones(n + 1)
    lower[1:] = beta.ppf(alpha / 2, counts[1:], n - counts[1:] + 1)
    upper[:-1] = beta.isf(alpha / 2, counts[:-1] + 1, n - counts[:-1])
    # Keep the same subtraction as the reporting rule. Moving threshold to
    # the other side can change strict equality after floating-point rounding.
    cutoff = np.full(n + 1, -1)
    rejected = n - counts + 1
    while np.any(rejected - cutoff > 1):
        active = rejected - cutoff > 1
        middle = (cutoff + rejected) // 2
        passes = lower - upper[np.clip(middle, 0, n)] > threshold
        cutoff = np.where(active & passes, middle, cutoff)
        rejected = np.where(active & ~passes, middle, rejected)
    conditional = min(1.0, p_negative / (1 - p_positive))
    probability = np.dot(binom.pmf(counts, n, p_positive),
                         binom.cdf(cutoff, n - counts, conditional))
    return float(np.clip(probability, 0, 1))


def paired_interval(positive, negative, n, confidence=0.95):
    """Return a conservative two-sided interval for the paired risk difference."""
    _counts(positive, negative, n)
    _probability(confidence, "confidence", open_interval=True)
    tail = (1 - confidence) / 4
    return (
        _lower(positive, n, tail) - _upper(negative, n, tail),
        _upper(positive, n, tail) - _lower(negative, n, tail),
    )
