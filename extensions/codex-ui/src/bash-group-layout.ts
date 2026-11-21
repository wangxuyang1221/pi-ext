import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { BashGroup, BashMember } from "./bash-groups.js";
import { fitToWidth, normalizeWidth } from "./layout.js";
import { toolStatusMarker } from "./tool-status.js";

const HEAD = 2, TAIL = 2;

function clean(text: string): string {
  return stripTerminalSequences(text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff\u202a-\u202e\u2066-\u2069\ufff9-\ufffb]/gu, "")
    .replace(/\t/gu, "  ");
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
    const text = (member.content ?? []).flatMap(block => {
      if (block.type !== "text") return [];
      const text = block.text;
      return typeof text === "string" ? [clean(text)] : [];
    }).join("\n");
    return text ? text.split("\n") : [];
  });
}
function diagnostic(member: BashMember): { text: string; warning: boolean } | undefined {
  if (member.status !== "failed") return undefined;
  const source = physical(member);
  const last = source.at(-1) ?? "";
  if (source.length > 1 && source.at(-2) !== "") return undefined;
  if (last === "Command aborted") return { text: "Interrupted", warning: true };
  if (/^Command timed out after \d+(?:\.\d+)? seconds$/u.test(last)) return { text: `Error: ${last}`, warning: true };
  const exit = /^Command exited with code (-?[1-9]\d*)$/u.exec(last);
  return exit ? { text: `Error: Exit code ${exit[1]}`, warning: false } : undefined;
}
const TRUNCATION_FOOTER = /^\[Showing (?:lines \d+-\d+ of \d+(?: \([^\n]* limit\))?|last [^\n]+ of line \d+ \(line is [^\n]+\))\. Full output: ([^\n]+)\]$/u;
function truncationWarning(member: BashMember): string | undefined {
  if (member.details?.truncation?.truncated) return `Truncated capture · ${member.details.fullOutputPath ? clean(member.details.fullOutputPath) : "full output unavailable"}`;
  if (member.status !== "failed") return undefined;
  // Failed execution loses details in the host. Only accept its final truncation footer.
  const source = physical(member);
  const footer = source.at(diagnostic(member) ? -3 : -1) ?? "";
  const match = TRUNCATION_FOOTER.exec(footer);
  return match ? `Truncated capture · ${match[1]}` : undefined;
}
function captureVariant(member: BashMember): "diagnostic" | "empty-sentinel" | "raw" {
  const source = physical(member);
  if (diagnostic(member)) return "diagnostic";
  return member.status === "completed" && source.length === 1 && source[0] === "(no output)" ? "empty-sentinel" : "raw";
}
const DIAGNOSTIC_TAIL_LINES = ["", "Command exited with code 1"].length;
function withoutDiagnosticTail(source: readonly string[]): readonly string[] {
  return source.slice(0, Math.max(0, source.length - DIAGNOSTIC_TAIL_LINES));
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
function capture(member: BashMember): string[] {
  const source = physical(member);
  const variant = captureVariant(member);
  if (variant === "empty-sentinel") return [];
  const body = trimBlankEdges(variant === "diagnostic" ? withoutDiagnosticTail(source) : source);
  // The warning row already shows the host's truncation footer, so the preview tail keeps real output.
  const output = truncationWarning(member) && TRUNCATION_FOOTER.test(body.at(-1) ?? "") ? trimBlankEdges(body.slice(0, -1)) : body;
  return dedent(collapseBlankRuns(output));
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
function statusLabel(member: BashMember): { text: string; color: "error" | "warning" } | undefined {
  const status = diagnostic(member);
  if (!status) return member.status === "failed" ? { text: "failed", color: "error" } : undefined;
  if (status.text === "Interrupted") return { text: "interrupted", color: "warning" };
  if (status.text.startsWith("Error: Command timed out")) return { text: "timed out", color: "warning" };
  const exit = /Exit code (-?\d+)/u.exec(status.text);
  return { text: exit ? `exit ${exit[1]}` : "failed", color: "error" };
}
function commandLines(member: BashMember, expanded: boolean, theme: Theme, width: number): string[] {
  const label = statusLabel(member);
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
    for (const line of commandLines(member, expanded, theme, width)) lines.push(line);
    const cache = member.cache;
    const indent = width >= 6 ? "    " : "";
    const contentWidth = Math.max(1, width - indent.length);
    const key = ["group-output", cache.identity(member), member.outputRevision, captureVariant(member), contentWidth].join("\0");
    const visual = cachedLines(member, "output", member.outputRevision, key, () => capture(member).flatMap(line => wrapTextWithAnsi(line, contentWidth)));
    const fingerprint = theme.fg("dim", "x") + theme.fg("toolOutput", "x");
    const styledKey = [key, "styled", expanded, width, toggleKeys, fingerprint, visual.length ? "" : member.status].join("\0");
    const styled = cachedLines(member, "output", member.outputRevision, styledKey, () => bodyRows(visual, expanded, member.status, toggleKeys).map(({ text, color }, index) =>
      theme.fg("dim", indent ? (index ? indent : "  └ ") : "") + theme.fg(color, fitToWidth(text, contentWidth, { ellipsis: "…" }))));
    for (const line of styled) lines.push(line);
    const warning = truncationWarning(member);
    if (warning) for (const line of wrapTextWithAnsi(warning, contentWidth)) lines.push(fitToWidth(indent + theme.fg("warning", line), width));
  }
  return lines;
}
