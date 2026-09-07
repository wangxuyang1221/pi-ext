import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

test("launcher exposes direct production and immutable comparison variants", () => {
  const help = execFileSync(process.execPath, [new URL("demo.mjs", import.meta.url).pathname, "--help"], { encoding: "utf8" });
  assert.match(help, /production\|proposed\|current/u);
  assert.match(help, /--upgrade-smoke/u);
});

test("frozen comparison sources match their recorded hashes and retain the old implementation", () => {
  const snapshot = JSON.parse(gunzipSync(readFileSync(new URL("../codex-ui-performance/baselines/reasoning-before.json.gz", import.meta.url))));
  for (const [name, source] of Object.entries(snapshot.sources)) {
    assert.equal(createHash("sha256").update(source).digest("hex"), snapshot.sha256[name], name);
  }
  assert.match(snapshot.sources["index.ts"], /compactThinkingMarkdown/u);
  assert.match(snapshot.sources["index.ts"], /TITLE_SPINNER_INTERVAL_MS = 500/u);
});
