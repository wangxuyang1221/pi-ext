"""Outcome-blind candidate discovery, not final benchmark eligibility.

Only explicit source identities enter ranking. This module neither exposes
reference patches nor certifies executable tasks or measured context size.
"""

import hashlib
import json
import re


def candidate_manifest(issues, trajectories, *, seed, dev_count, pilot_count):
    """Select one issue and trajectory per repository, with disjoint splits."""
    if not isinstance(seed, str) or not seed:
        raise ValueError("A nonempty sampling seed is required.")
    if any(type(n) is not int or n < 0 for n in (dev_count, pilot_count)):
        raise ValueError("Split counts must be nonnegative integers.")

    def rank(*parts):
        return hashlib.sha256(json.dumps([seed, *parts], separators=(",", ":"),
                                         ensure_ascii=False).encode()).hexdigest()

    by_id = {}
    for issue in issues:
        identity, repo, commit = (issue.get(key) for key in ("instance_id", "repo", "base_commit"))
        if not isinstance(identity, str) or not identity or identity in by_id:
            raise ValueError("Issue identities must be unique nonempty strings.")
        if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise ValueError("A source repository owner/name is required.")
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise ValueError("A full source commit is required.")
        by_id[identity] = {"instance_id": identity, "repo": repo.lower(), "base_commit": commit}
    locators, per_issue, unmatched = set(), {}, set()
    for trajectory in trajectories:
        identity = trajectory.get("instance_id")
        shard, row = trajectory.get("shard"), trajectory.get("row")
        if not isinstance(identity, str) or not identity:
            raise ValueError("Trajectory identity is required.")
        if any(type(n) is not int or n < 0 for n in (shard, row)):
            raise ValueError("A nonnegative shard and row locator is required.")
        locator = (shard, row)
        if locator in locators:
            raise ValueError("Duplicate source locator.")
        locators.add(locator)
        if identity not in by_id:
            unmatched.add(identity)
            continue
        per_issue.setdefault(identity, []).append({"shard": shard, "row": row})
    per_repo = {}
    for identity in per_issue:
        per_repo.setdefault(by_id[identity]["repo"], []).append(identity)
    repositories = sorted(per_repo, key=lambda repo: (rank("repository", repo), repo))
    if len(repositories) < dev_count + pilot_count:
        raise ValueError("Not enough disjoint repositories for the requested splits.")
    candidates = []
    for index, repo in enumerate(repositories):
        identity = min(per_repo[repo], key=lambda i: (rank("issue", i), i))
        locator = min(per_issue[identity], key=lambda r: (rank("trajectory", identity, r["shard"], r["row"]), r["shard"], r["row"]))
        split = "development" if index < dev_count else "pilot" if index < dev_count + pilot_count else "holdout"
        candidates.append({**by_id[identity], "independence_id": repo, "trajectory": locator, "split": split})
    return {
        "schema_version": 1, "seed": seed, "dev_count": dev_count, "pilot_count": pilot_count,
        "selection": "sha256_repository_issue_trajectory_v1", "unit": "one_issue_per_repository",
        "candidates": candidates, "unmatched_instances": sorted(unmatched),
        "status": "candidate_discovery_not_validated_or_frozen",
    }
