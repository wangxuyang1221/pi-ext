import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { BashGroup, BashMember } from "../../../shared/ui/bash-groups.js";
import { sanitizeDiffSource } from "../../../shared/ui/diff-source.js";
import { fitToWidth, normalizeWidth } from "../../../shared/ui/layout.js";
import { toolStatusMarker } from "../../../shared/ui/tool-status.js";

const HEAD = 2, TAIL = 2;
const MAX_WARNING_ERROR_CODEPOINTS = 256;

interface ParsedDiagnostic {
  kind: "short" | "extended";
  title?: { text: string; warning: boolean };
  bodyEnd: number;
}

interface ParsedFooter {
  kind: "path" | "error";
  rawValue: string;
  start: number;
  end: number;
  singleLine: boolean;
}

interface RawTail {
  diagnostic?: ParsedDiagnostic;
  footerAtEnd?: ParsedFooter;
  footerBeforeDiag?: ParsedFooter;
}

interface MemberAnalysis {
  diagnostic?: { text: string; warning: boolean };
  bodyEnd: number;
  stripFooter?: { start: number; end: number };
  emptySentinel: boolean;
  warning?: string;
}

const rawTails = new WeakMap<readonly string[], RawTail>();

const EXIT_CODE_RE = /^Command exited with code (-?[1-9]\d*)$/u;
const TIMEOUT_RE = /^Command timed out after \d+(?:\.\d+)? seconds$/u;
const EXTENDED_TIMEOUT_RE = /^Command timed out after \d+(?:\.\d+)? seconds\. The shell exited with code -?\d+ after \d+(?:\.\d+)? seconds, but background processes it started kept writing output until the timeout\.$/u;
const FOOTER_RE = /^\[Showing (?:lines \d+-\d+ of \d+(?: \([^\n()]+ limit\))?|last [^\n()]+ of line \d+ \(line is [^\n()]+\))\. (Full output: |Could not save the full output: )([\s\S]*)\]$/u;

function clean(text: string): string {
  return stripTerminalSequences(text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff\u202a-\u202e\u2066-\u2069\ufff9-\ufffb]/gu, "")
    .replace(/\t/gu, "  ");
}

function cleanWarningValue(text: string, maxCodePoints?: number): string {
  const sanitized = clean(sanitizeDiffSource(text))
    .replace(/[\r\n\u2028\u2029]+/gu, " ")
    .trim();
  if (!maxCodePoints || sanitized.length <= maxCodePoints) return sanitized;
  const points = Array.from(sanitized);
  return points.length > maxCodePoints ? `${points.slice(0, maxCodePoints).join("")}…` : sanitized;
}

function parseDiagnostic(lines: readonly string[]): ParsedDiagnostic | undefined {
  if (!lines.length) return undefined;
  const last = lines.at(-1) ?? "";
  if (lines.length > 1 && lines.at(-2) !== "") return undefined;
  const bodyEnd = Math.max(0, lines.length - 2);
  if (last === "Command aborted") return { kind: "short", title: { text: "Interrupted", warning: true }, bodyEnd };
  if (TIMEOUT_RE.test(last)) return { kind: "short", title: { text: `Error: ${last}`, warning: true }, bodyEnd };
  const exit = EXIT_CODE_RE.exec(last);
  if (exit) return { kind: "short", title: { text: `Error: Exit code ${exit[1]}`, warning: false }, bodyEnd };
  if (last === "Command terminated without an exit code" || EXTENDED_TIMEOUT_RE.test(last)) {
    return { kind: "extended", bodyEnd };
  }
  return undefined;
}

function parseFooter(lines: readonly string[], limit: number): ParsedFooter | undefined {
  let end = limit;
  while (end > 0 && !lines[end - 1]!.trim()) end--;
  if (end === 0 || !lines[end - 1]!.endsWith("]")) return undefined;
  for (let start = end - 1; start >= 0; start--) {
    const line = lines[start]!;
    if (!line.startsWith("[Showing ")) continue;
    if (start > 0 && lines[start - 1]!.trim() !== "") continue;
    const candidate = start === end - 1 ? line : lines.slice(start, end).join("\n");
    const match = FOOTER_RE.exec(candidate);
    if (!match) return undefined;
    return {
      kind: match[1] === "Full output: " ? "path" : "error",
      rawValue: match[2] ?? "",
      start,
      end,
      singleLine: start === end - 1,
    };
  }
  return undefined;
}

function extractRawTail(rawLines: readonly string[], cleanLines: readonly string[]): RawTail {
  if (!cleanLines.length) return {};
  const diagnostic = parseDiagnostic(cleanLines);
  const rawDiag = parseDiagnostic(rawLines);
  const resolveFooter = (cleanLimit: number, rawLimit: number): ParsedFooter | undefined => {
    const cleanFooter = parseFooter(cleanLines, cleanLimit);
    const rawFooter = parseFooter(rawLines, rawLimit);
    if (!cleanFooter || !rawFooter || rawFooter.kind !== cleanFooter.kind) return undefined;
    return {
      kind: cleanFooter.kind,
      rawValue: rawFooter.rawValue,
      start: cleanFooter.start,
      end: cleanFooter.end,
      singleLine: cleanFooter.singleLine && rawFooter.singleLine,
    };
  };
  const footerAtEnd = resolveFooter(cleanLines.length, rawLines.length);
  const footerBeforeDiag = diagnostic
    ? resolveFooter(diagnostic.bodyEnd, rawDiag ? rawDiag.bodyEnd : rawLines.length)
    : undefined;
  return { diagnostic, footerAtEnd, footerBeforeDiag };
}

function cachedLines(member: BashMember, slotKind: "command" | "output", revision: number, key: string, compute: () => string[]): string[] {
  const cache = member.cache;
  if (cache.linesForRevision) {
    return cache.linesForRevision(`bash-${slotKind}\0${cache.identity(member)}`, revision, key, compute);
  }
  return cache.lines(key, compute);
}

function physical(member: BashMember): string[] {
  const cache = member.cache;
  const key = `group-clean\0${cache.identity(member)}\0${member.outputRevision}`;
  return cachedLines(member, "output", member.outputRevision, key, () => {
    const rawBlocks = (member.content ?? []).flatMap(block => {
      if (block.type !== "text") return [];
      const text = block.text;
      return typeof text === "string" ? [text] : [];
    });
    const rawText = rawBlocks.join("\n");
    const cleanText = rawBlocks.map(clean).join("\n");
    const lines = cleanText ? cleanText.split("\n") : [];
    const rawLines = rawText ? rawText.split("\n") : [];
    rawTails.set(lines, extractRawTail(rawLines, lines));
    return lines;
  });
}

function formatWarning(kind: "path" | "error" | "unavailable", rawValue = ""): string {
  if (kind === "path") {
    const cleaned = cleanWarningValue(rawValue);
    return cleaned ? `Truncated capture · ${cleaned}` : "Truncated capture · full output unavailable";
  }
  if (kind === "error") {
    const cleaned = cleanWarningValue(rawValue, MAX_WARNING_ERROR_CODEPOINTS);
    return cleaned ? `Truncated capture · Could not save the full output: ${cleaned}` : "Truncated capture · full output unavailable";
  }
  return "Truncated capture · full output unavailable";
}

function analyze(member: BashMember): MemberAnalysis {
  const source = physical(member);
  const tail = rawTails.get(source);
  const failed = member.status === "failed";
  const parsedDiag = failed ? tail?.diagnostic : undefined;
  const diagnostic = parsedDiag?.kind === "short" ? parsedDiag.title : undefined;
  const bodyEnd = parsedDiag?.kind === "short" ? parsedDiag.bodyEnd : source.length;
  const candidate = parsedDiag ? tail?.footerBeforeDiag : tail?.footerAtEnd;

  const details = member.details;
  const pathRaw = typeof details?.fullOutputPath === "string" ? details.fullOutputPath : undefined;
  const pathClean = pathRaw !== undefined ? cleanWarningValue(pathRaw) : "";
  const errorRaw = typeof details?.fullOutputError === "string" ? details.fullOutputError : undefined;
  const errorClean = errorRaw !== undefined ? cleanWarningValue(errorRaw, MAX_WARNING_ERROR_CODEPOINTS) : "";
  const truncatedFlag = details?.truncation?.truncated === true;

  let warning: string | undefined;
  let stripFooter: { start: number; end: number } | undefined;
  const canStrip = member.status !== "running";

  if (pathClean) {
    warning = `Truncated capture · ${pathClean}`;
    if (canStrip && candidate && candidate.kind === "path" && candidate.rawValue === pathRaw) {
      stripFooter = { start: candidate.start, end: candidate.end };
    }
  } else if (errorClean) {
    warning = `Truncated capture · Could not save the full output: ${errorClean}`;
    if (canStrip && candidate && candidate.kind === "error" && candidate.rawValue === errorRaw) {
      stripFooter = { start: candidate.start, end: candidate.end };
    }
  } else if (truncatedFlag || Boolean(pathRaw?.trim()) || Boolean(errorRaw?.trim())) {
    if (canStrip && candidate) {
      const matchedRaw = (pathRaw !== undefined && candidate.kind === "path" && candidate.rawValue === pathRaw)
        || (errorRaw !== undefined && candidate.kind === "error" && candidate.rawValue === errorRaw);
      if (matchedRaw) {
        warning = "Truncated capture · full output unavailable";
        stripFooter = { start: candidate.start, end: candidate.end };
      } else if (truncatedFlag && pathRaw === undefined && errorRaw === undefined && candidate.singleLine) {
        warning = formatWarning(candidate.kind, candidate.rawValue);
        stripFooter = { start: candidate.start, end: candidate.end };
      } else {
        warning = "Truncated capture · full output unavailable";
      }
    } else {
      warning = "Truncated capture · full output unavailable";
    }
  } else if (failed && canStrip && candidate?.singleLine) {
    warning = formatWarning(candidate.kind, candidate.rawValue);
    stripFooter = { start: candidate.start, end: candidate.end };
  }

  const emptySentinel = !diagnostic && member.status === "completed" && source.length === 1 && source[0] === "(no output)";
  return { diagnostic, bodyEnd, stripFooter, emptySentinel, warning };
}

function trimBlankEdges(lines: readonly string[]): readonly string[] {
  let first = 0, last = lines.length;
  while (first < last && !lines[first]!.trim()) first++;
  while (last > first && !lines[last - 1]!.trim()) last--;
  return lines.slice(first, last);
}

function collapseBlankRuns(lines: readonly string[]): string[] {
  return lines.filter((line, index) => line.trim() || lines[index - 1]?.trim());
}

function dedent(lines: readonly string[]): string[] {
  let shared = Infinity;
  for (const line of lines) if (line.trim()) shared = Math.min(shared, line.length - line.trimStart().length);
  return shared > 0 && Number.isFinite(shared) ? lines.map(line => line.slice(shared)) : [...lines];
}

function capture(member: BashMember, analysis: MemberAnalysis): string[] {
  if (analysis.emptySentinel) return [];
  const source = physical(member);
  const sliced = analysis.stripFooter
    ? [...source.slice(0, analysis.stripFooter.start), ...source.slice(analysis.stripFooter.end, analysis.bodyEnd)]
    : source.slice(0, analysis.bodyEnd);
  return dedent(collapseBlankRuns(trimBlankEdges(sliced)));
}

type BodyRow = { text: string; color: "toolOutput" | "dim" };
function bodyRows(visual: readonly string[], expanded: boolean, status: BashMember["status"], toggleKeys: string): BodyRow[] {
  if (!visual.length) return [{ text: status === "running" ? "Running…" : "(no output)", color: "dim" }];
  if (expanded || visual.length <= HEAD + TAIL + 1) return visual.map(text => ({ text, color: "toolOutput" }));
  const head = visual.slice(0, HEAD), tail = visual.slice(-TAIL);
  while (head.length > 1 && !head.at(-1)!.trim()) head.pop();
  while (tail.length > 1 && !tail[0]!.trim()) tail.shift();
  const hidden = visual.length - head.length - tail.length;
  return [
    ...head.map(text => ({ text, color: "toolOutput" as const })),
    { text: `… +${hidden} lines${toggleKeys ? ` (${toggleKeys} to expand)` : ""}`, color: "dim" },
    ...tail.map(text => ({ text, color: "toolOutput" as const })),
  ];
}

function statusLabel(member: BashMember, status: MemberAnalysis["diagnostic"]): { text: string; color: "error" | "warning" } | undefined {
  if (!status) return member.status === "failed" ? { text: "failed", color: "error" } : undefined;
  if (status.text === "Interrupted") return { text: "interrupted", color: "warning" };
  if (status.text.startsWith("Error: Command timed out")) return { text: "timed out", color: "warning" };
  const exit = /Exit code (-?\d+)/u.exec(status.text);
  return { text: exit ? `exit ${exit[1]}` : "failed", color: "error" };
}

function commandLines(member: BashMember, analysis: MemberAnalysis, expanded: boolean, theme: Theme, width: number): string[] {
  const label = statusLabel(member, analysis.diagnostic);
  const status = label?.color === "warning" ? "interrupted" : member.status;
  const prefix = width >= 8 ? `${toolStatusMarker(theme, status, "$")} ${theme.bold("Bash")}(` : "";
  const suffix = label && width >= 24 ? theme.fg("dim", " · ") + theme.fg(label.color, label.text) : "";
  const continuation = width >= 8 ? "  " : "";
  const cache = member.cache;
  const key = ["group-command", cache.identity(member), member.commandRevision, expanded, width, suffix].join("\0");
  const commands = cachedLines(member, "command", member.commandRevision, key, () => {
    const command = clean(member.command) || "…";
    if (!expanded) return [fitToWidth(command.replace(/\n/gu, " "), Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix) - 1), { ellipsis: "…" }) + ")" + suffix];
    const [head = "", ...tail] = (command + ")").split("\n");
    const [first = "", ...overflow] = wrapTextWithAnsi(head, Math.max(1, width - visibleWidth(prefix)));
    const lines = [first, ...overflow, ...tail.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - continuation.length)))];
    const last = lines.length - 1;
    if (visibleWidth((last ? continuation : prefix) + lines[last] + suffix) <= width) lines[last] += suffix;
    else if (suffix) lines.push(suffix);
    return lines;
  });
  return commands.map((line, index) => fitToWidth((index ? continuation : prefix) + line, width));
}

export function renderBashGroup(group: BashGroup, expanded: boolean, theme: Theme, availableWidth: number, toggleKeys: string): string[] {
  const width = normalizeWidth(availableWidth);
  if (!width) return [];
  const lines: string[] = [];
  for (const member of group.members) {
    if (member.status === "pending") continue;
    if (lines.length) lines.push("");
    const analysis = analyze(member);
    for (const line of commandLines(member, analysis, expanded, theme, width)) lines.push(line);
    const cache = member.cache;
    const indent = width >= 6 ? "    " : "";
    const contentWidth = Math.max(1, width - indent.length);
    const captureKey = analysis.emptySentinel
      ? "empty"
      : `${analysis.bodyEnd}:${analysis.stripFooter ? `${analysis.stripFooter.start}-${analysis.stripFooter.end}` : "none"}`;
    const key = ["group-output", cache.identity(member), member.outputRevision, captureKey, contentWidth].join("\0");
    const visual = cachedLines(member, "output", member.outputRevision, key, () =>
      capture(member, analysis).flatMap(line => wrapTextWithAnsi(line, contentWidth)));
    const fingerprint = theme.fg("dim", "x") + theme.fg("toolOutput", "x");
    const styledKey = [key, "styled", expanded, width, toggleKeys, fingerprint, visual.length ? "" : member.status].join("\0");
    const styled = cachedLines(member, "output", member.outputRevision, styledKey, () => bodyRows(visual, expanded, member.status, toggleKeys).map(({ text, color }, index) =>
      theme.fg("dim", indent ? (index ? indent : "  └ ") : "") + theme.fg(color, fitToWidth(text, contentWidth, { ellipsis: "…" }))));
    for (const line of styled) lines.push(line);
    if (analysis.warning) {
      for (const line of wrapTextWithAnsi(analysis.warning, contentWidth)) lines.push(fitToWidth(indent + theme.fg("warning", line), width));
    }
  }
  return lines;
}
