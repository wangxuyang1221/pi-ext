"""Outcome-blind corpus partition checks."""

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "scripts" / "codex_compact_quality_corpus.py"


def load_module():
    if not MODULE.exists():
        return None
    spec = importlib.util.spec_from_file_location("quality_corpus", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


corpus = load_module()


class CandidateManifestTests(unittest.TestCase):
    def test_partitions_share_no_repositories_or_outcome_information(self):
        self.assertTrue(callable(getattr(corpus, "candidate_manifest", None)))
        issues = [{"instance_id": f"issue-{i}", "repo": f"owner/repo-{i // 2}",
                   "base_commit": f"{i:040x}", "patch": "HIDDEN"} for i in range(8)]
        trajectories = [{"instance_id": f"issue-{i // 3}", "shard": 0, "row": i,
                         "target": bool(i % 2), "generated_patch": "HIDDEN"} for i in range(24)]
        result = corpus.candidate_manifest(issues, trajectories, seed="fixed", dev_count=1, pilot_count=1)
        self.assertEqual(len(result["candidates"]), 4)
        self.assertEqual(len({r["repo"] for r in result["candidates"]}), 4)
        self.assertEqual([r["split"] for r in result["candidates"]], ["development", "pilot", "holdout", "holdout"])
        self.assertNotIn("HIDDEN", str(result))
        reversed_labels = [{**r, "target": not r["target"]} for r in reversed(trajectories)]
        self.assertEqual(result, corpus.candidate_manifest(list(reversed(issues)), reversed_labels,
                                                         seed="fixed", dev_count=1, pilot_count=1))

    def test_unmatched_sources_are_quarantined_not_assumed_to_be_known_dev_data(self):
        result = corpus.candidate_manifest([], [{"instance_id": "unknown", "shard": 2, "row": 0}],
                                           seed="fixed", dev_count=0, pilot_count=0)
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["unmatched_instances"], ["unknown"])

    def test_duplicate_locators_and_insufficient_disjoint_repositories_fail_closed(self):
        issue = {"instance_id": "a", "repo": "owner/repo", "base_commit": "a" * 40}
        row = {"instance_id": "a", "shard": 0, "row": 0}
        with self.assertRaises(ValueError):
            corpus.candidate_manifest([issue], [row, row], seed="fixed", dev_count=0, pilot_count=0)
        with self.assertRaises(ValueError):
            corpus.candidate_manifest([issue], [row], seed="fixed", dev_count=1, pilot_count=1)
        with self.assertRaises(ValueError):
            corpus.candidate_manifest([issue, issue], [row], seed="fixed", dev_count=0, pilot_count=0)

    def test_repository_case_does_not_create_independence(self):
        issues = [{"instance_id": "a", "repo": "owner/repo", "base_commit": "a" * 40},
                  {"instance_id": "b", "repo": "OWNER/Repo", "base_commit": "b" * 40}]
        rows = [{"instance_id": "a", "shard": 0, "row": 0}, {"instance_id": "b", "shard": 1, "row": 0}]
        result = corpus.candidate_manifest(issues, rows, seed="fixed", dev_count=0, pilot_count=0)
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["candidates"][0]["independence_id"], "owner/repo")


if __name__ == "__main__":
    unittest.main()
