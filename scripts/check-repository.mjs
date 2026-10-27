import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))];
const available = new Set(files.filter(file => existsSync(resolve(root, file))));
const failures = [];
function check(target, owner, from = root) {
  const absolute = resolve(from, target);
  const local = relative(root, absolute).split(sep).join("/");
  if (!available.has(local)) failures.push(`${owner}: missing or untracked ignored target ${target}`);
}

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const [name, command] of Object.entries(pkg.scripts)) {
  for (const match of command.matchAll(/(?:\.\/)?(?:scripts|extensions|prototypes)\/[\w./-]+\.(?:mjs|py|json)\b/g)) {
    check(match[0], `script ${name}`);
  }
}

let documents = 0;
for (const file of available) {
  if (!file.endsWith(".md") || file.includes("/media/third-party/") || file.includes("/media/license-overrides/")) continue;
  documents++;
  const source = readFileSync(resolve(root, file), "utf8");
  for (const match of source.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const url = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(url)) continue;
    const target = decodeURIComponent(url.split("#")[0]);
    if (!target) continue;
    check(target, `${file}:${source.slice(0, match.index).split("\n").length}`, dirname(resolve(root, file)));
  }
}
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`Verified script entry paths and local links in ${documents} repository documents.`);
