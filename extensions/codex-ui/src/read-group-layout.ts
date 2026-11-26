import { basename, dirname } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fitToWidth, normalizeWidth } from "./layout.js";
import type { ReadMember, ReadRow } from "./read-groups.js";
import { fileFailureStatus, toolStatusColor, toolStatusMarker } from "./tool-status.js";

const PREVIEW_LINES = 3;
const EXPANDED_LINES = 40;
const PREVIEW_CHARS = 512;
function clean(text: string): string {
  return stripTerminalSequences(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff\u202a-\u202e\u2066-\u2069\ufff9-\ufffb]/gu, "").replace(/\t/gu, "  ");
}
function sourceKey(member: ReadRow): string {
  return `read-source\0${member.cache.identity(member)}\0${member.revision}\0${member.offset}\0${member.limit}`;
}
function source(member: ReadRow): string[] {
  return member.cache.lines(sourceKey(member), () => {
    const text = (member.content ?? []).filter(block => block.type === "text").map(block => block.text ?? "").join("\n");
    if (member.status === "failed") return [text, ""];
    const truncation = member.details?.truncation;
    if (truncation?.truncated) {
      if (truncation.firstLineExceedsLimit) return ["", text, "0"];
      if (typeof truncation.content === "string" && text.startsWith(truncation.content + "\n\n[Showing lines ")) {
        return [truncation.content, text.slice(truncation.content.length + 2), String(truncation.outputLines)];
      }
    }
    const footer = text.lastIndexOf("\n\n[");
    if (member.limit !== undefined && footer >= 0) {
      const notice = text.slice(footer + 2);
      const match = notice.match(/^\[\d+ more lines in file\. Use offset=(\d+) to continue\.\]$/u);
      if (match && Number(match[1]) === (member.offset ?? 1) + member.limit) {
        return [text.slice(0, footer), notice, String(member.limit)];
      }
    }
    return [text, ""];
  });
}
function count(member: ReadRow, text: string): number {
  return member.cache.count(`${sourceKey(member)}\0count`, () => {
    if (!text) return 0;
    let count = text.endsWith("\n") ? 0 : 1;
    for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) count++;
    return count;
  });
}
function prefixes(member: ReadRow, text: string, expanded: boolean, lineCount: number): string[] {
  return member.cache.lines(`${sourceKey(member)}\0prefix\0${expanded}`, () => {
    const lines: string[] = [];
    let start = 0;
    for (let index = 0; index < Math.min(lineCount, expanded ? EXPANDED_LINES : PREVIEW_LINES) && start <= text.length; index++) {
      const newline = text.indexOf("\n", start);
      const end = newline < 0 ? text.length : newline;
      const stop = expanded ? end : Math.min(end, start + PREVIEW_CHARS);
      lines.push(clean(text.slice(start, stop)) + (stop < end ? "…" : ""));
      start = end + 1;
    }
    return lines;
  });
}
function headingWidth(right: string, width: number): number {
  const available = width - visibleWidth(right);
  return available >= 16 ? available : width;
}
function withMetadata(left: string, right: string, width: number): string {
  const available = headingWidth(right, width);
  return fitToWidth(left, available, { ellipsis: "…" }) + (available < width ? right : "");
}
function fitDirectory(dir: string, room: number): string {
  if (dir === "./") return "";
  if (visibleWidth(dir) <= room) return dir;
  return room >= 2 ? `${fitToWidth(dir, room - 1, { ellipsis: "…" })}/` : "";
}
function renderMember(member: ReadRow, expanded: boolean, grouped: boolean, theme: Theme, width: number): string[] {
  const cache = member.cache;
  const colors = (["accent", "toolTitle", "text", "dim", "toolOutput", "success", "warning", "error"] as const)
    .map(color => theme.fg(color, "x")).join("\0");
  const key = ["read-layout", cache.identity(member), member.revision, member.path, member.fullPath, member.offset, member.limit,
    member.status, width, expanded, grouped, colors].join("\0");
  return cache.lines(key, () => {
    const path = clean(member.path).replace(/\n/gu, " ");
    const filename = basename(path) || "(unknown path)";
    const dir = dirname(path) === "." ? "./" : `${dirname(path)}/`;
    const pending = member.status === "pending" || member.status === "running";
    const failed = member.status === "failed";
    const status = failed ? fileFailureStatus(member.content) : member.status;
    const failureColor = toolStatusColor(status);
    const [text = "", notice = "", sourceCount] = pending ? [] : source(member);
    const lineCount = pending ? 0 : sourceCount === undefined ? count(member, text) : Number(sourceCount);
    const image = member.content?.some(block => block.type === "image");
    const unsupportedModel = !pending && !failed && typeof member.details?.imageUnsupportedByModel === "string"
      ? clean(member.details.imageUnsupportedByModel).replace(/\n/gu, " ").trim()
      : "";
    const imageWarning = unsupportedModel
      ? `[${unsupportedModel} does not support images; it saw a placeholder instead]`
      : "";
    let meta = pending ? "Reading…" : status === "interrupted" ? "Interrupted" : failed ? "Failed" : image ? "Image loaded"
      : `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
    if (!pending && !failed && !image && lineCount && (member.offset !== undefined || member.limit !== undefined)) {
      meta = `L${member.offset ?? 1}–${(member.offset ?? 1) + lineCount - 1} · ${meta}`;
    }
    if (!pending && member.details?.truncation?.truncated) meta += " · truncated";
    const mark = toolStatusMarker(theme, status, "@");
    const title = `${mark} ${grouped ? "" : theme.fg("toolTitle", theme.bold("Read")) + " "}`;
    const metadata = theme.fg(failed ? failureColor : "dim", ` · ${meta}`);
    const room = headingWidth(metadata, width) - visibleWidth(title) - visibleWidth(filename);
    const shownDir = fitDirectory(dir, room);
    const lines = [withMetadata(`${title}${shownDir ? theme.fg("dim", shownDir) : ""}${theme.fg("accent", filename)}`, metadata, width)];
    const gutter = "    ";
    if (failed) lines.push(fitToWidth(theme.fg("dim", "  └ ") + theme.fg(failureColor, clean(text.slice(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"))) || "Read failed"), width));
    else if (expanded && !pending && lineCount > 0) {
      const shown = prefixes(member, text, expanded, lineCount);
      const numberWidth = String((member.offset ?? 1) + shown.length - 1).length;
      shown.forEach((line, index) => lines.push(fitToWidth(theme.fg("dim", `${index ? gutter : "  └ "}${String((member.offset ?? 1) + index).padStart(numberWidth)}  `)
        + theme.fg("toolOutput", line), width, { ellipsis: "…" })));
      if (lineCount > shown.length) lines.push(fitToWidth(theme.fg("dim", `${gutter}… +${lineCount - shown.length} lines`), width));
    }
    if (notice && expanded) lines.push(fitToWidth(theme.fg("dim", `${gutter}${clean(notice)}`), width, { ellipsis: "…" }));
    if (imageWarning) {
      const indent = width >= 6 ? gutter : "";
      const contentWidth = Math.max(1, width - indent.length);
      const firstPrefix = indent ? (lines.length > 1 ? gutter : "  └ ") : "";
      wrapTextWithAnsi(imageWarning, contentWidth).forEach((line, index) => {
        lines.push(fitToWidth(theme.fg("dim", index ? indent : firstPrefix) + theme.fg("warning", line), width));
      });
    }
    return lines;
  });
}

export function renderSingleRead(row: ReadRow, expanded: boolean, theme: Theme, availableWidth: number): string[] {
  const width = normalizeWidth(availableWidth);
  return width ? renderMember(row, expanded, false, theme, width) : [];
}

/** The source group's first member emits its previews; ambiguous views stay local. */
export function renderReadGroup(member: ReadMember, expanded: boolean, theme: Theme, availableWidth: number): string[] {
  const width = normalizeWidth(availableWidth);
  if (!width || member.group.members[0] !== member) return [];
  const grouped = member.group.members.length > 1;
  const inset = grouped && width > 2 ? "  " : "";
  const lines = grouped ? [fitToWidth(`${theme.fg("dim", expanded ? "▾" : "▸")} ${theme.fg("toolTitle", theme.bold("Read"))} ${theme.fg("muted", `${member.group.members.length} files`)}`, width)] : [];
  for (const item of member.group.members) {
    for (const line of renderMember(item, expanded, grouped, theme, width - inset.length)) lines.push(inset + line);
  }
  return lines;
}
