import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSnapshot, repositoryRoot } from "./repository-snapshot.mjs";

export function checkRepository(files) {
  const failures = [];
  function check(target, owner, from = ".") {
    const local = posix.normalize(posix.join(from, target));
    if (!files.has(local)) failures.push(`${owner}: missing repository target ${JSON.stringify(target)}`);
  }

  let pkg;
  try { pkg = JSON.parse(files.get("package.json")?.content.toString("utf8") ?? ""); }
  catch { throw new Error("package.json is missing or invalid in the inspected snapshot."); }
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    for (const match of command.matchAll(/(?:\.\/)?(?:scripts|extensions|prototypes)\/[\w./-]+\.(?:mjs|py|json)\b/g)) {
      check(match[0], `script ${name}`);
    }
  }

  let documents = 0;
  for (const [file, entry] of files) {
    if (entry.mode === "120000") continue;
    if (!file.endsWith(".md") || file.includes("/media/third-party/") || file.includes("/media/license-overrides/")) continue;
    documents++;
    const source = entry.content.toString("utf8");
    for (const match of source.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const url = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(url)) continue;
      const target = decodeURIComponent(url.split("#")[0]);
      if (!target) continue;
      check(target, `${JSON.stringify(file)}:${source.slice(0, match.index).split("\n").length}`, posix.dirname(file));
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return documents;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== "--staged")) throw new Error("Usage: check-repository.mjs [--staged]");
    const snapshot = readSnapshot(repositoryRoot(), process.argv.includes("--staged"));
    const documents = checkRepository(snapshot.files);
    snapshot.assertUnchanged();
    console.log(`Verified script entry paths and local links in ${documents} repository documents.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
