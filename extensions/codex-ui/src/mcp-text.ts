/** Shared display sanitization, also used by the legacy MCP diagnostic adapter. */
export const DEFAULT_FIELD_BYTES = 4 * 1024;

export function sanitizeDiagnosticText(value: string, maxBytes = DEFAULT_FIELD_BYTES): string {
  try {
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : DEFAULT_FIELD_BYTES;
    return truncateUtf8(redactString(sanitizeControls(value)), limit).value;
  } catch {
    return "[unavailable]";
  }
}

export function truncateUtf8(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean; originalBytes: number } {
  const limit = Math.max(1, Math.floor(maxBytes));
  const originalBytes = Buffer.byteLength(value, "utf8");
  if (originalBytes <= limit) return { value, truncated: false, originalBytes };
  const suffix = `… [truncated; originalBytes=${originalBytes}]`;
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const decoration = suffixBytes <= limit ? suffix : "";
  const target = Math.max(0, limit - Buffer.byteLength(decoration, "utf8"));
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > target) break;
    output += character;
    bytes += nextBytes;
  }
  return { value: `${output}${decoration}`, truncated: true, originalBytes };
}

export function sanitizeControls(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

export function redactString(value: string): string {
  let output = value.replace(/__PI_MCP_HTTP_OBSERVATION_[0-9]+__(?:\r?\n)?/g, "");
  output = output.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
  output = output.replace(/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\n]+/gi, "$1: [redacted]");
  output = output.replace(/([?&](?:api[-_]?key|token|access[-_]?token|refresh[-_]?token|password|passwd|secret|client[-_]?secret)=)[^&#\s]*/gi, "$1[redacted]");
  output = output.replace(/(["']?(?:api[-_]?key|token|access[-_]?token|refresh[-_]?token|password|passwd|secret|client[-_]?secret)["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi, "$1[redacted]");
  output = output.replace(/\b(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[redacted]:[redacted]@");
  return output;
}
