import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const commit = "6b9826e3aa83b1a5947db50f4332cb9c65f1b340";
const source = resolve(process.argv[2] ?? ".tmp/codex-compact-audit/codex");
const output = resolve(process.argv[3] ?? "extensions/codex-compact/__tests__/fixtures/codex-reference.json");
if (execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== commit) throw new Error("Unexpected Codex reference revision");
const paths = {
  truncation: "codex-rs/utils/string/src/truncate.rs",
  history: "codex-rs/core/src/context_manager/history.rs",
  images: "codex-rs/core/src/compact_remote_v2_image_budget_tests.rs",
};
const files = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(join(source, path), "utf8")]));
for (const path of Object.values(paths)) execFileSync("git", ["-C", source, "diff", "--exit-code", "HEAD", "--", path]);
const work = resolve(".tmp/codex-compact-audit/reference");
mkdirSync(work, { recursive: true });
const functionSource = (name) => {
  const start = files.history.indexOf(`fn ${name}(`);
  const end = files.history.indexOf("\n}", start) + 2;
  if (start < 0 || end < start) throw new Error(`Reference function missing: ${name}`);
  return files.history.slice(start, end);
};
// Compile the pinned upstream module itself, not a second JavaScript implementation.
const rust = `#[path = ${JSON.stringify(join(source, paths.truncation))}] mod upstream;
use std::io::{self, BufRead};
${functionSource("estimate_reasoning_length")}
${functionSource("estimate_encrypted_function_output_length")}
fn main() {
  for line in io::stdin().lock().lines() {
    let line = line.unwrap(); let p: Vec<_> = line.split('\\t').collect();
    let n: usize = p[1].parse().unwrap();
    let bytes: Vec<u8> = p.get(2).unwrap_or(&"").as_bytes().chunks(2).map(|b| u8::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap()).collect();
    let text = String::from_utf8(bytes).unwrap();
    match p[0] {
      "count" => println!("{}", upstream::approx_token_count(&text)),
      "reasoning" => println!("{}", upstream::approx_tokens_from_byte_count(estimate_reasoning_length(n))),
      "output" => println!("{}", estimate_encrypted_function_output_length(n)),
      "truncate" => { let value = upstream::truncate_middle_with_token_budget(&text, n).0; println!("{}", value.as_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>()); },
      _ => panic!("unknown operation")
    }
  }
}`;
writeFileSync(join(work, "main.rs"), rust);
execFileSync("rustc", ["--edition=2021", "-Awarnings", join(work, "main.rs"), "-o", join(work, "reference")]);
const corpus = ["", "abcdefghijklmnop", "earlier text", "中文约束：不修改数据库。", "🙂中a🙂tail", JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "中文🙂" }] })];
const cases = corpus.flatMap((text) => [{ operation: "count", text, budget: 0 }, ...[0, 1, 2, 4, 16, 100].map((budget) => ({ operation: "truncate", text, budget }))]);
for (const budget of [0, 6, 866, 867, 868, 4000, 100000]) cases.push({ operation: "reasoning", text: "", budget }, { operation: "output", text: "", budget });
const input = cases.map(({ operation, text, budget }) => `${operation}\t${budget}\t${Buffer.from(text).toString("hex")}`).join("\n") + "\n";
const lines = execFileSync(join(work, "reference"), [], { input, encoding: "utf8" }).split("\n");
const vectors = cases.map((entry, index) => ({ ...entry, expected: entry.operation === "truncate" ? Buffer.from(lines[index], "hex").toString() : Number(lines[index]) }));
const message = (content) => ({ type: "message", role: "user", content });
const text = (text) => ({ type: "input_text", text });
const image = { type: "input_image", image_url: "data:image/png;base64,abc" };
const newest = message([text("new")]);
// These input/expected pairs are taken from the pinned official image-budget tests.
const imageVectors = [1845, 1844, 1].map((budget) => ({
  test: "image_only_boundary_is_atomic_and_does_not_backfill_older_messages", budget,
  input: [message([text("old")]), message([image]), newest], expected: budget === 1845 ? [message([image]), newest] : [newest],
}));
const result = { commit, rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(), sources: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, sha256: createHash("sha256").update(files[key]).digest("hex"), url: `https://github.com/openai/codex/blob/${commit}/${path}` }])), vectors, imageVectors };
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(`Generated ${vectors.length} upstream Rust vectors and ${imageVectors.length} upstream image test vectors: ${output}`);
