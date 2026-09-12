import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { BashGroup, BashMember } from "./bash-groups.js";
import { fitToWidth, normalizeWidth } from "./layout.js";

function clean(text: string): string {
  return stripTerminalSequences(text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff\u202a-\u202e\u2066-\u2069\ufff9-\ufffb]/gu, "")
    .replace(/\t/gu, "  ");
}
function physical(member: BashMember): string[] {
  const cache = member.cache;
  return cache.lines(`group-clean\0${cache.identity(member)}\0${member.outputRevision}`, () => {
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
function truncationWarning(member: BashMember): string | undefined {
  if (member.details?.truncation?.truncated) return `Truncated capture · ${member.details.fullOutputPath ? clean(member.details.fullOutputPath) : "full output unavailable"}`;
  if (member.status !== "failed") return undefined;
  // Failed execution loses details in the host. Only accept its final truncation footer.
  const source = physical(member);
  const footer = source.at(diagnostic(member) ? -3 : -1) ?? "";
  const match = /^\[Showing (?:lines \d+-\d+ of \d+(?: \([^\n]* limit\))?|last [^\n]+ of line \d+ \(line is [^\n]+\))\. Full output: ([^\n]+)\]$/u.exec(footer);
  return match ? `Truncated capture · ${match[1]}` : undefined;
}
function capture(member: BashMember, expanded: boolean): string[] {
  const source = physical(member);
  if (member.status === "completed" && source.length === 1 && source[0] === "(no output)") return ["(No content)"];
  const status = !expanded && diagnostic(member);
  if (!status) return source;
  // The host appends a blank separator plus a final diagnostic. Keep raw text on expansion.
  return [status.text, ...source.slice(0, Math.max(0, source.length - 2))];
}
function commandLines(member: BashMember, expanded: boolean, theme: Theme, width: number): string[] {
  const color = member.status === "completed" ? "success" : member.status === "failed" && !diagnostic(member)?.warning ? "error" : "warning";
  const prefix = width >= 8 ? `${theme.fg(color, "⏺")} ${theme.bold("Bash")}(` : "";
  const continuation = width >= 8 ? "  " : "";
  const cache = member.cache;
  const key = ["group-command", cache.identity(member), member.commandRevision, expanded, width].join("\0");
  const commands = cache.lines(key, () => {
    const command = clean(member.command) || "…";
    if (!expanded) return [fitToWidth(command.replace(/\n/gu, " "), Math.max(0, width - visibleWidth(prefix) - 1), { ellipsis: "…" }) + ")"];
    const [head = "", ...tail] = (command + ")").split("\n");
    const [first = "", ...overflow] = wrapTextWithAnsi(head, Math.max(1, width - visibleWidth(prefix)));
    return [first, ...overflow, ...tail.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - continuation.length)))];
  });
  return commands.map((line, index) => fitToWidth((index ? continuation : prefix) + line, width));
}

/** Render full-mode Bash calls using the selected Claude-style inline layout. */
export function renderBashGroup(group: BashGroup, expanded: boolean, theme: Theme, availableWidth: number, toggleKeys: string): string[] {
  const width = normalizeWidth(availableWidth);
  if (!width) return [];
  const lines: string[] = [];
  for (const member of group.members) {
    if (member.status === "pending") continue;
    if (lines.length) lines.push("");
    for (const line of commandLines(member, expanded, theme, width)) lines.push(line);
    const cache = member.cache;
    const indent = width >= 6 ? "     " : "";
    const contentWidth = Math.max(1, width - indent.length);
    const source = physical(member);
    const variant = !expanded && diagnostic(member)?.text
      || (member.status === "completed" && source.length === 1 && source[0] === "(no output)" ? "empty-sentinel" : "raw");
    const key = ["group-output", cache.identity(member), member.outputRevision, variant, expanded, contentWidth].join("\0");
    const output = cache.lines(key, () => {
      const source = capture(member, expanded);
      if (expanded) return source.flatMap(line => wrapTextWithAnsi(line, contentWidth));
      const preview: string[] = [];
      for (const line of source) {
        for (const visual of wrapTextWithAnsi(line, contentWidth)) {
          preview.push(visual);
          if (preview.length === 3) break;
        }
        if (preview.length === 3) break;
      }
      return preview;
    });
    const body = output.length ? output : [member.status === "running" ? "Running…" : member.status === "failed" ? "Command failed" : "(No content)"];
    const bodyColor = member.status === "failed" ? diagnostic(member)?.warning ? "warning" : "error" : "text";
    const fingerprint = theme.fg("dim", "x") + theme.fg(bodyColor, "x");
    const styled = cache.lines(`${key}\0styled\0${width}\0${fingerprint}\0${output.length ? "" : member.status}`, () => body.map((line, index) =>
      theme.fg("dim", index ? indent : indent ? "  ⎿  " : "") + theme.fg(bodyColor, fitToWidth(line, contentWidth))));
    for (const line of styled) lines.push(line);
    if (!expanded && output.length === 3) {
      // Cache one total per capture, not every physical line: line keys can evict
      // the totals of otherwise stable groups from the shared 2 MiB budget.
      const count = cache.count(`${key}\0total`, () => capture(member, expanded)
        .reduce((total, line) => total + wrapTextWithAnsi(line, contentWidth).length, 0));
      if (count > 3) lines.push(fitToWidth(theme.fg("dim", `${indent}… +${count - 3} lines${toggleKeys ? ` (${toggleKeys} to expand)` : ""}`), width));
    }
    const warning = truncationWarning(member);
    if (warning) for (const line of wrapTextWithAnsi(warning, contentWidth)) lines.push(fitToWidth(indent + theme.fg("warning", line), width));
  }
  return lines;
}
