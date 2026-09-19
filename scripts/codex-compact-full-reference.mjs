import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { boundaryReferenceSource } from "./codex-compact-boundary-reference-source.mjs";

const commit = "6b9826e3aa83b1a5947db50f4332cb9c65f1b340";
const root = resolve(process.argv[2] ?? ".tmp/codex-compact-audit/codex");
const work = resolve(process.argv[3] ?? ".tmp/codex-alignment/full-reference");
const workspace = resolve(".tmp/codex-alignment/reference-source");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== commit) throw new Error("Unexpected reference commit");
execFileSync("git", ["-C", root, "diff", "--exit-code", "HEAD", "--", "codex-rs"]);
if (!existsSync(workspace)) cpSync(join(root, "codex-rs"), workspace, { recursive: true });
for (const relative of execFileSync("git", ["-C", root, "ls-files", "-z", "--", "codex-rs"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).split("\0").filter(Boolean)) {
  if (relative === "codex-rs/Cargo.lock") continue;
  if (sha256(readFileSync(join(root, relative))) !== sha256(readFileSync(join(workspace, relative.slice("codex-rs/".length))))) {
    throw new Error(`Modified reference dependency source: ${relative}`);
  }
}
// Compile real protocol serde and utility crates; the shim only supplies the enclosing history storage.
const historyPath = "core/src/context_manager/history.rs";
const history = readFileSync(join(root, "codex-rs", historyPath), "utf8");
const estimator = history.slice(history.indexOf("fn estimate_reasoning_length("), history.indexOf("\nfn is_model_generated_item("));
const aggregateStart = history.indexOf("    pub(crate) fn estimate_token_count_with_base_instructions(");
const aggregate = history.slice(aggregateStart, history.indexOf("\n    pub(crate) fn remove_first_item", aggregateStart));
const modelItemStart = history.indexOf("fn is_model_generated_item(");
const modelItem = history.slice(modelItemStart, history.indexOf("\npub(crate) fn is_user_turn_boundary", modelItemStart));
const tailStart = history.indexOf("    fn items_after_last_model_generated_item(");
const tailMethod = history.slice(tailStart, history.indexOf("\n    }", tailStart) + 6);
if (!estimator || !aggregate) throw new Error("Missing upstream estimator extraction");
mkdirSync(join(work, "src"), { recursive: true });
const boundaries = boundaryReferenceSource(root);
writeFileSync(join(work, "src/boundaries.rs"), boundaries.code);
const path = (relative) => JSON.stringify(join(workspace, relative));
writeFileSync(join(work, "Cargo.toml"), `[package]
name = "codex-full-estimator-reference"
version = "0.1.0"
edition = "2024"
[dependencies]
codex-protocol = { path = ${path("protocol")} }
codex-utils-audio = { path = ${path("utils/audio")} }
codex-utils-cache = { path = ${path("utils/cache")} }
codex-utils-output-truncation = { path = ${path("utils/output-truncation")} }
base64 = "=0.22.1"
image = { version = "=0.25.9", default-features = false, features = ["jpeg", "png", "gif", "webp"${process.platform === "darwin" ? ', "tiff"' : process.platform === "win32" ? ', "bmp"' : ""}] }
serde = "1"
serde_json = "1"
tracing = "0.1"
[profile.dev]
debug = 0
`);
writeFileSync(join(work, "src/main.rs"), `use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use codex_protocol::models::{AgentMessageInputContent, BaseInstructions, ContentItem, FunctionCallOutputBody, FunctionCallOutputContentItem, ImageDetail, ResponseItem};
use codex_utils_audio::estimate_audio_token_count;
use codex_utils_cache::{BlockingLruCache, sha1_digest};
use codex_utils_output_truncation::{approx_bytes_for_tokens, approx_token_count, approx_tokens_from_byte_count_i64};
use std::{num::NonZeroUsize, sync::LazyLock, io::{self, BufRead}};
#[path = ${JSON.stringify(join(root, "codex-rs/core/src/utils/json.rs"))}] mod upstream_json;
use upstream_json::serialized_json_bytes;
mod boundaries;
use boundaries::is_user_turn_boundary;
${estimator}
${modelItem}
struct Envelope { item: ResponseItem }
struct ContextManager { items: Vec<Envelope> }
impl ContextManager {
${aggregate}
${boundaries.oldReasoningMethod}
${tailMethod}
}
#[derive(serde::Deserialize)]
struct Request { items: Vec<ResponseItem>, #[serde(default)] instructions: String, #[serde(default)] tools: Option<Vec<serde_json::Value>> }
fn evaluate(request: Request) -> Result<serde_json::Value, serde_json::Error> {
    let items = request.items;
    let turn_boundaries: Vec<bool> = items.iter().map(is_user_turn_boundary).collect();
    let normalized = serde_json::to_value(&items)?;
    let counts: Vec<i64> = items.iter().map(estimate_item_token_count).collect();
    let context = ContextManager { items: items.into_iter().map(|item| Envelope { item }).collect() };
    let base = BaseInstructions { text: request.instructions, provenance: None };
    let total = context.estimate_token_count_with_base_instructions(&base);
    // This byte counter verifies the plugin's different HTTP framing; it is not
    // presented as an extra part of Codex's canonical history token estimate.
    let mut prefix = serde_json::json!({"instructions": base.text, "input": [{"type": "compaction_trigger"}]});
    if let Some(tools) = request.tools { prefix["tools"] = serde_json::to_value(tools)?; }
    let wire_prefix_bytes = serialized_json_bytes(&prefix).unwrap();
    let tail_tokens = context.items_after_last_model_generated_item().map(estimate_item_token_count).fold(0i64, i64::saturating_add);
    Ok(serde_json::json!({"normalized": normalized, "counts": counts, "total": total, "turnBoundaries": turn_boundaries, "oldReasoningTokens": context.get_non_last_reasoning_items_tokens(), "wirePrefixBytes": wire_prefix_bytes, "tailTokens": tail_tokens}))
}
fn main() {
    for line in io::stdin().lock().lines() {
        let output = serde_json::from_str::<Request>(&line.unwrap()).and_then(evaluate).unwrap_or_else(|error| serde_json::json!({"error": error.to_string()}));
        println!("{}", output);
    }
}
`);
if (!existsSync(join(work, "Cargo.lock"))) cpSync(join(root, "codex-rs/Cargo.lock"), join(work, "Cargo.lock"));
const externalPackages = (lock) => new Map(lock.split("[[package]]").slice(1).flatMap((block) => {
  const name = /^name = "([^"]+)"$/m.exec(block)?.[1];
  const version = /^version = "([^"]+)"$/m.exec(block)?.[1];
  const source = /^source = "([^"]+)"$/m.exec(block)?.[1];
  return source ? [[`${name}@${version}`, { source, checksum: /^checksum = "([^"]+)"$/m.exec(block)?.[1] }]] : [];
}));
execFileSync("cargo", ["+stable", "build", "--manifest-path", join(work, "Cargo.toml")], {
  stdio: "inherit", env: { ...process.env, CARGO_HOME: resolve(".tmp/codex-alignment/cargo-home"), CARGO_TARGET_DIR: join(work, "target") },
});
const expected = externalPackages(readFileSync(join(root, "codex-rs/Cargo.lock"), "utf8"));
for (const [name, info] of externalPackages(readFileSync(join(work, "Cargo.lock"), "utf8"))) {
  if (JSON.stringify(expected.get(name)) !== JSON.stringify(info)) throw new Error(`Reference dependency diverged from upstream: ${name}`);
}
const provenance = { commit, platform: process.platform,
  rustc: execFileSync("rustc", ["+stable", "--version"], { encoding: "utf8" }).trim(),
  sources: { ...boundaries.sources, [historyPath]: sha256(history), "core/src/utils/json.rs": sha256(readFileSync(join(root, "codex-rs/core/src/utils/json.rs"))) },
  extractedEstimatorSha256: sha256(estimator), extractedAggregateSha256: sha256(aggregate),
  binarySha256: sha256(readFileSync(join(work, "target/debug/codex-full-estimator-reference"))),
  lockSha256: sha256(readFileSync(join(work, "Cargo.lock"))) };
writeFileSync(join(work, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Built original full ResponseItem estimator: ${work}`);
