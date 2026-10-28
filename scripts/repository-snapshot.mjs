import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

export function git(root, args, options = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"], ...options });
  } catch {
    // Git errors can include blob contents. Never forward them to CI logs.
    throw new Error(`Git ${args[0]} failed; repository inspection is incomplete.`);
  }
}

export function repositoryRoot() {
  return git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
}

export function indexEntries(root) {
  return git(root, ["ls-files", "--stage", "-z"]);
}

export function readBlobs(root, oids) {
  const blobs = new Map();
  if (!oids.length) return blobs;
  const data = git(root, ["cat-file", "--batch"], { input: oids.join("\n") + "\n", encoding: null });
  let offset = 0;
  for (const oid of oids) {
    const end = data.indexOf(10, offset);
    const match = /^([a-f\d]+) blob (\d+)$/.exec(data.subarray(offset, end).toString("utf8"));
    if (!match || match[1] !== oid) throw new Error("Cannot read repository blob.");
    const size = Number(match[2]);
    offset = end + 1;
    if (offset + size >= data.length) throw new Error("Incomplete repository blob.");
    blobs.set(oid, data.subarray(offset, offset + size));
    offset += size + 1;
  }
  return blobs;
}

export function readSnapshot(root, staged = false) {
  const entries = indexEntries(root);
  const files = new Map();
  if (staged) {
    const metadata = entries.split("\0").filter(Boolean).map(entry => {
      const match = /^(\d+) ([a-f\d]+) (\d)\t([\s\S]+)$/.exec(entry);
      if (!match || match[3] !== "0") throw new Error("Unmerged index entries must be resolved before checking.");
      if (!["100644", "100755", "120000"].includes(match[1])) {
        throw new Error(`Unsupported index entry: ${JSON.stringify(match[4])}.`);
      }
      return { mode: match[1], oid: match[2], path: match[4] };
    });
    const blobs = readBlobs(root, metadata.map(entry => entry.oid));
    for (const entry of metadata) files.set(entry.path, { mode: entry.mode, content: blobs.get(entry.oid) });
  } else {
    const paths = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    for (const path of new Set(paths.split("\0").filter(Boolean))) {
      const absolute = resolve(root, path);
      let stat;
      try { stat = lstatSync(absolute); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (stat.isSymbolicLink()) files.set(path, { mode: "120000", content: Buffer.from(readlinkSync(absolute)) });
      else if (stat.isFile()) files.set(path, { mode: "100644", content: readFileSync(absolute) });
      else throw new Error(`Unsupported repository entry: ${JSON.stringify(path)}.`);
    }
  }
  return { files, assertUnchanged() {
    if (staged && indexEntries(root) !== entries) throw new Error("Index changed during inspection; run the check again.");
  } };
}

export function historyEntries(root) {
  const raw = git(root, ["log", "--all", "--root", "--format=", "--raw", "-z", "--no-abbrev",
    "--no-renames", "--diff-merges=first-parent", "--diff-filter=AM"]).split("\0");
  const entries = new Map();
  for (let index = 0; index < raw.length; index += 2) {
    if (!raw[index].trim()) continue;
    const match = /^:\d+ (\d+) [a-f\d]+ ([a-f\d]+) [AM]$/.exec(raw[index].trim());
    if (!match || !raw[index + 1]) throw new Error("Cannot inspect Git history records.");
    const [, mode, oid] = match;
    const path = raw[index + 1];
    if (!["100644", "100755", "120000"].includes(mode)) throw new Error("Unsupported historical Git entry.");
    entries.set(`${oid}\0${path}`, { mode, oid, path });
  }
  return [...entries.values()];
}
