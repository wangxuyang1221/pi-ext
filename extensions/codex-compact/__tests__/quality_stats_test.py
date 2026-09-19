"""Independent-session inference checks; these are not model-quality results."""

import importlib.util
from pathlib import Path
import unittest

import numpy as np
from scipy.stats import binomtest, multinomial

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "scripts" / "codex_compact_quality_stats.py"


def load_stats():
    if not MODULE.exists():
        return None
    spec = importlib.util.spec_from_file_location("quality_stats", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stats = load_stats()


class PairedIntervalTests(unittest.TestCase):
    def test_all_ties_preserve_unobserved_discordance_uncertainty(self):
        self.assertTrue(callable(getattr(stats, "paired_interval", None)),
                        "The paired interval must be implemented before reporting quality.")
        low, high = stats.paired_interval(0, 0, 100)
        bound = 1 - 0.0125 ** (1 / 100)
        self.assertAlmostEqual(low, -bound, places=12)
        self.assertAlmostEqual(high, bound, places=12)
        self.assertGreater(high, 0.04)

    def test_interval_matches_independent_scipy_exact_implementation(self):
        for n in (1, 2, 7, 20):
            for positive in range(n + 1):
                for negative in range(n - positive + 1):
                    a = binomtest(positive, n).proportion_ci(0.975, method="exact")
                    b = binomtest(negative, n).proportion_ci(0.975, method="exact")
                    actual = stats.paired_interval(positive, negative, n)
                    np.testing.assert_allclose(actual, (a.low - b.high, a.high - b.low), atol=2e-12)

    def test_small_sample_interval_covers_boundary_parameter_grid(self):
        for n in (1, 3, 8):
            counts = [(b, c, n - b - c) for b in range(n + 1) for c in range(n - b + 1)]
            intervals = [stats.paired_interval(b, c, n) for b, c, _ in counts]
            for p in (0, 0.01, 0.1, 0.3, 0.5, 0.9, 1):
                for q in (0, 0.01, 0.1, 0.3, 0.5, 0.9, 1):
                    if p + q > 1:
                        continue
                    weights = multinomial.pmf(counts, n, [p, q, max(0, 1 - p - q)])
                    coverage = sum(w for w, (lo, hi) in zip(weights, intervals)
                                   if lo - 1e-12 <= p - q <= hi + 1e-12)
                    self.assertGreaterEqual(coverage, 0.95 - 1e-12, (n, p, q))

    def test_formal_lower_bound_uses_allocated_one_sided_error(self):
        self.assertTrue(callable(getattr(stats, "paired_lower_bound", None)))
        alpha = 0.05 / 2
        lower = stats.paired_lower_bound(0, 0, 100, alpha)
        self.assertAlmostEqual(lower, -(1 - (alpha / 2) ** 0.01), places=12)
        self.assertLess(stats.paired_lower_bound(0, 0, 10, alpha), -0.05)
        self.assertGreater(stats.paired_lower_bound(0, 0, 100, alpha), -0.05)

    def test_invalid_counts_and_probabilities_are_rejected(self):
        for counts in ((0, 0, 0), (-1, 0, 1), (1, 1, 1), (True, 0, 1), (0.0, 0, 1)):
            with self.assertRaises(ValueError):
                stats.paired_interval(*counts)
        for alpha in (0, 1, float("nan"), float("inf"), True):
            with self.assertRaises(ValueError):
                stats.paired_lower_bound(0, 0, 1, alpha)
        lo, hi = stats.paired_interval(8, 2, 20)
        reverse_lo, reverse_hi = stats.paired_interval(2, 8, 20)
        np.testing.assert_allclose((lo, hi), (-reverse_hi, -reverse_lo))

    def test_absolute_interval_does_not_equate_all_fail_with_good_quality(self):
        self.assertTrue(callable(getattr(stats, "absolute_interval", None)))
        failed = stats.absolute_interval(0, 100)
        passed = stats.absolute_interval(100, 100)
        self.assertEqual(failed[0], 0)
        self.assertEqual(passed[1], 1)
        self.assertLess(failed[1], 0.04)
        self.assertGreater(passed[0], 0.96)
        expected = binomtest(7, 20).proportion_ci(0.95, method="exact")
        np.testing.assert_allclose(stats.absolute_interval(7, 20), (expected.low, expected.high))


class PowerTests(unittest.TestCase):
    def test_power_matches_exhaustive_multinomial_decisions(self):
        self.assertTrue(callable(getattr(stats, "paired_power", None)))
        for n in (1, 8, 25):
            for p, q in ((0, 0), (1, 0), (0, 1), (0.3, 0.1), (0.9, 0.1)):
                for threshold in (0, -0.05, -0.5):
                    expected = 0.0
                    for b in range(n + 1):
                        for c in range(n - b + 1):
                            if stats.paired_lower_bound(b, c, n, 0.025) > threshold:
                                expected += multinomial.pmf([b, c, n - b - c], n,
                                                            [p, q, max(0, 1 - p - q)])
                    actual = stats.paired_power(n, p, q, threshold, 0.025)
                    self.assertAlmostEqual(actual, expected, places=11,
                                           msg=str((n, p, q, threshold)))

    def test_power_agrees_with_seeded_monte_carlo(self):
        self.assertTrue(callable(getattr(stats, "paired_power", None)))
        n, alpha, threshold = 120, 0.025, -0.05
        draws = np.random.default_rng(92341).multinomial(n, [0.10, 0.02, 0.88], size=20000)
        unique, counts = np.unique(draws, axis=0, return_counts=True)
        observed = sum(count for (b, c, _), count in zip(unique, counts)
                       if stats.paired_lower_bound(int(b), int(c), n, alpha) > threshold) / len(draws)
        exact = stats.paired_power(n, 0.10, 0.02, threshold, alpha)
        self.assertLess(abs(exact - observed), 0.02)

    def test_power_uses_the_same_strict_floating_point_decision_at_the_boundary(self):
        n, alpha, p, q = 8, 0.025, 0.3, 0.2
        for b0 in range(n + 1):
            for c0 in range(n - b0 + 1):
                threshold = stats.paired_lower_bound(b0, c0, n, alpha)
                expected = sum(multinomial.pmf([b, c, n - b - c], n, [p, q, 1 - p - q])
                               for b in range(n + 1) for c in range(n - b + 1)
                               if stats.paired_lower_bound(b, c, n, alpha) > threshold)
                self.assertAlmostEqual(stats.paired_power(n, p, q, threshold, alpha), expected, places=12)

    def test_invalid_design_probabilities_are_rejected(self):
        for p, q in ((0.8, 0.3), (-0.1, 0.2), (float("nan"), 0.1), (True, 0)):
            with self.assertRaises(ValueError):
                stats.paired_power(100, p, q, 0, 0.025)


class SessionSummaryTests(unittest.TestCase):
    def test_repeats_remain_clustered_and_failures_are_not_discarded(self):
        self.assertTrue(callable(getattr(stats, "paired_summary", None)))
        rows = [
            {"independence_id": "issue-a", "repeat": 0, "outcomes": {"new": True, "old": True}},
            {"independence_id": "issue-a", "repeat": 1, "outcomes": {"new": False, "old": True}},
            {"independence_id": "issue-b", "repeat": 0, "outcomes": {"new": True, "old": False}},
            {"independence_id": "issue-b", "repeat": 1, "outcomes": {"new": True, "old": True}},
        ]
        result = stats.paired_summary(rows, "new", "old", repeats=[0, 1], alpha=0.025, threshold=0)
        self.assertEqual(result["n"], 2)
        self.assertEqual(result["positive"], 1)
        self.assertEqual(result["negative"], 1)
        self.assertEqual(result["difference"], 0)
        self.assertEqual(result["candidate_successes"], 1)
        self.assertFalse(result["passes_threshold"])
        self.assertEqual(result["aggregation"], "all_prespecified_repeats_pass")
        with self.assertRaises(ValueError):
            stats.paired_summary(rows[:-1], "new", "old", repeats=[0, 1], alpha=0.025, threshold=0)
        with self.assertRaises(ValueError):
            stats.paired_summary(rows + rows[:1], "new", "old", repeats=[0, 1], alpha=0.025, threshold=0)


if __name__ == "__main__":
    unittest.main()
