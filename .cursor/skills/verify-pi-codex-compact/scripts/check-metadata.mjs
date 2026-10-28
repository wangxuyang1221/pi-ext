#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const evidence = resolve(process.argv[2]);
const summary = JSON.parse(readFileSync(join(evidence, "summary.json"), "utf8"));
const journey = JSON.parse(readFileSync(join(evidence, "journey.json"), "utf8"));
assert.equal(summary.status, "passed");
assert.equal(summary.cleanup, "removed");
assert.equal(journey.processStopped, true);
assert.ok(["metadata", "metadata-project"].includes(journey.case));
const project = journey.case === "metadata-project";
for (const [step, expected] of Object.entries(project
  ? { status: "0.158.0 (project,", saved: "0.158.0 (project,", reset: "0.158.0 (project," }
  : { status: "0.156.0 (default)", saved: "0.157.0 (global,", reset: "0.156.0 (default)" })) {
  const screen = journey.screens[step].replace(/\s+/g, " ");
  const marker = "Effective metadata client version: ";
  const offset = screen.lastIndexOf(marker);
  assert.ok(offset >= 0, `Missing effective version at ${step}`);
  const current = screen.slice(offset);
  assert.ok(current.startsWith(marker + expected), `Wrong version or source at ${step}`);
  assert.ok(current.includes("Usage: /codex-metadata [version <major.minor.patch>|reset]"), `Incomplete current notification at ${step}`);
  if (project) assert.ok(current.includes("Project override remains active: 0.158.0"));
}
assert.equal(journey.events.filter(event => event.type === "request").length, 0);
console.log(JSON.stringify({ evidence, case: journey.case, currentNotificationsVerified: true }));
