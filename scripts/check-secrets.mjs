import { historyEntries, readBlobs, readSnapshot, repositoryRoot } from "./repository-snapshot.mjs";
import { reportSecrets, scanSecrets } from "./secret-scan.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !["--staged", "--history"].includes(arg))) {
    throw new Error("Usage: check-secrets.mjs [--staged|--history]");
  }
  const root = repositoryRoot();
  const snapshot = readSnapshot(root, args.includes("--staged"));
  let count = snapshot.files.size;
  let findingCount = 0;
  if (args.includes("--history")) {
    const entries = historyEntries(root);
    count = entries.length;
    for (let start = 0; start < entries.length; start += 64) {
      const batch = entries.slice(start, start + 64);
      const blobs = readBlobs(root, [...new Set(batch.map(entry => entry.oid))]);
      for (const entry of batch) {
        const findings = await scanSecrets(new Map([[entry.path, { mode: entry.mode, content: blobs.get(entry.oid) }]]), snapshot.files);
        if (findings.length) console.error(`Historical blob ${entry.oid}:`);
        reportSecrets(findings);
        findingCount += findings.length;
      }
    }
  } else {
    const findings = await scanSecrets(snapshot.files);
    reportSecrets(findings);
    findingCount = findings.length;
  }
  snapshot.assertUnchanged();
  if (findingCount) throw new Error("Secret findings require review.");
  console.log(`Secret scan passed for ${count} ${args.includes("--history") ? "historical file versions" : "files"}. Archives and encoded payloads are not decoded.`);
} catch {
  // Scanner exceptions may contain source text; only our own reports expose finding locations.
  console.error("Secret scan failed. Fix reported findings or verify scanner dependencies and exception configuration.");
  process.exitCode = 1;
}
