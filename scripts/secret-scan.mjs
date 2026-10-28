import { createHash } from "node:crypto";
import { extname, posix } from "node:path";

const exceptionsPath = "config/secret-exceptions.json";
export const fingerprint = value => createHash("sha256").update(value).digest("hex");

function readExceptions(files) {
  let entries;
  try { entries = JSON.parse(files.get(exceptionsPath)?.content.toString("utf8") ?? "[]"); }
  catch { throw new Error("Invalid secret exception configuration."); }
  if (!Array.isArray(entries) || entries.some(entry => !entry ||
    typeof entry.path !== "string" || !entry.path || posix.normalize(entry.path) !== entry.path ||
    entry.path.startsWith("/") || entry.path.startsWith("../") || /[*?\[\]\\]/.test(entry.path) ||
    typeof entry.ruleId !== "string" || !entry.ruleId || typeof entry.messageId !== "string" || !entry.messageId ||
    !/^[a-f\d]{64}$/.test(entry.sha256) || typeof entry.reason !== "string" || !entry.reason.trim())) {
    throw new Error("Secret exceptions require an exact path, ruleId, messageId, SHA-256, and reason.");
  }
  return entries;
}

export async function scanSecrets(files, exceptionFiles = files) {
  // Debug logging in dependencies is outside the redacted report contract.
  delete process.env.DEBUG;
  const [{ lintSource }, { rules }] = await Promise.all([
    import("@secretlint/core"), import("@secretlint/secretlint-rule-preset-recommend"),
  ]);
  // Register scanners directly: source comments must not disable the gate.
  const config = { rules: rules.filter(rule => rule.meta.type === "scanner" &&
    rule.meta.id !== "@secretlint/secretlint-rule-filter-comments").map(rule => ({
    id: rule.meta.id, rule, options: {}, severity: "error",
  })) };
  const exceptions = readExceptions(exceptionFiles);
  const findings = [];
  for (const [path, entry] of files) {
    const content = entry.content.toString("utf8");
    const result = await lintSource({ source: { content, filePath: path, ext: extname(path), contentType: "text" },
      options: { config, maskSecrets: true, noPhysicFilePath: true } });
    for (const message of result.messages) {
      const sha256 = fingerprint(content.slice(...message.range));
      if (exceptions.some(exception => exception.path === path && exception.ruleId === message.ruleId &&
        exception.messageId === message.messageId && exception.sha256 === sha256)) continue;
      findings.push({ path, ruleId: message.ruleId, messageId: message.messageId,
        line: message.loc.start.line, column: message.loc.start.column, sha256 });
    }
  }
  return findings;
}

export function reportSecrets(findings) {
  for (const finding of findings) {
    console.error(`${JSON.stringify(finding.path)}:${finding.line}:${finding.column} ${finding.ruleId}/${finding.messageId} sha256=${finding.sha256}`);
  }
}
