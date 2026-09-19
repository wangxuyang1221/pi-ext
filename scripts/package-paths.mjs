const forbiddenDirectoryNames = new Set([
  "__tests__", "test", "tests", "fixture", "fixtures", "log", "logs",
]);

/** Reject test fixtures and logs regardless of their parent directory. */
export function assertSafePublishedPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some(segment => forbiddenDirectoryNames.has(segment.toLowerCase()))) {
    throw new Error(`Test fixture or log path must not be published: ${normalized}`);
  }
  const basename = segments.at(-1) ?? "";
  if (/\.(?:log|jsonl|ndjson)(?:\.|$)/i.test(basename) || /(?:^|[._-])fixtures?(?:[._-]|$)/i.test(basename)) {
    throw new Error(`Test fixture or log file must not be published: ${normalized}`);
  }
}
