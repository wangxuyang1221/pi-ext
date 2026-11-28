const LIST_ITEM_PREFIX = /^([ \t]*)(?:([-+*])|\d{1,9}([.)]))([ \t]+|$)/u;
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/u;
const THEMATIC_BREAK = /^([ \t]*)([-*_])(?:[ \t]*\2){2,}[ \t]*$/u;
const BLOCK_INTERRUPT = /^[ \t]*(?:#{1,6}(?:[ \t]|$)|>)/u;

interface ListLevel {
  markerIndent: number;
  contentIndent: number;
  delimiter: string;
  emptyItem: boolean;
}

function indentWidth(prefix: string): number {
  let width = 0;
  for (let i = 0; i < prefix.length; i++) {
    // Pi's Markdown component expands tabs to 3 spaces before lexing.
    width += prefix[i] === "\t" ? 3 : 1;
  }
  return width;
}

function leadingIndent(line: string): number {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 3;
    else break;
  }
  return width;
}

/**
 * Quote each thinking block separately so every rendered line keeps a left rail
 * while preserving Pi's per-top-level-block streaming and highlight caches.
 */
export function formatThinkingBlocks(markdown: string): string {
  if (!markdown.trim()) return markdown;
  const lines = markdown.split(/\r?\n/u);
  const output = ["> **Thinking**", ""];
  const listStack: ListLevel[] = [];
  let fenceChar = "";
  let fenceLength = 0;
  let fenceMinIndent = 0;
  let fenceMaxIndent = 0;
  let pendingBlanks = 0;
  let started = false;

  const clearFence = (): void => {
    fenceChar = "";
    fenceLength = 0;
    fenceMinIndent = 0;
    fenceMaxIndent = 0;
  };

  const tryOpenFence = (segment: string, minIndent: number, maxIndent: number): boolean => {
    const open = FENCE_OPEN.exec(segment);
    if (!open || indentWidth(open[1]!) > maxIndent) return false;
    const marker = open[2]!;
    const info = open[3] ?? "";
    if (marker[0] === "~" || !info.includes("`")) {
      fenceChar = marker[0]!;
      fenceLength = marker.length;
      fenceMinIndent = minIndent;
      fenceMaxIndent = maxIndent;
      return true;
    }
    return false;
  };

  const isSiblingListItem = (top: ListLevel, parentContentIndent: number, markerIndent: number, delimiter: string | undefined): boolean => (
    delimiter === top.delimiter
    && markerIndent >= parentContentIndent
    && markerIndent < top.contentIndent
    && markerIndent <= parentContentIndent + 3
  );

  for (const line of lines) {
    if (!started && !line.trim()) continue;
    started = true;

    if (!line.trim()) {
      pendingBlanks++;
      continue;
    }

    const indent = leadingIndent(line);

    if (fenceChar) {
      if (indent < fenceMinIndent) {
        clearFence();
      } else {
        for (let i = 0; i < pendingBlanks; i++) output.push(">");
        pendingBlanks = 0;
        output.push(`> ${line}`);
        const close = FENCE_CLOSE.exec(line);
        if (close && indentWidth(close[1]!) <= fenceMaxIndent && close[2]![0] === fenceChar && close[2]!.length >= fenceLength) {
          clearFence();
        }
        continue;
      }
    }

    const thematicBreak = THEMATIC_BREAK.exec(line);
    const isThematicBreak = Boolean(thematicBreak && indentWidth(thematicBreak[1]!) <= (listStack.at(-1)?.contentIndent ?? 0) + 3);
    const listMatch = isThematicBreak ? null : LIST_ITEM_PREFIX.exec(line);
    const delimiter = listMatch ? (listMatch[2] ?? listMatch[3]) : undefined;
    const markerIndent = listMatch ? indentWidth(listMatch[1]!) : -1;
    const openCandidate = FENCE_OPEN.exec(line);
    const isOpeningFence = Boolean(
      openCandidate
      && indentWidth(openCandidate[1]!) <= 3
      && (openCandidate[2]![0] === "~" || !(openCandidate[3] ?? "").includes("`")),
    );
    const interruptsParagraph = Boolean(delimiter || isThematicBreak || isOpeningFence || BLOCK_INTERRUPT.test(line));

    // Lazy continuation lines without a preceding blank line keep the active list open.
    if (pendingBlanks > 0 || interruptsParagraph) {
      while (listStack.length > 0) {
        const top = listStack.at(-1)!;
        if (indent >= top.contentIndent && !(pendingBlanks > 0 && top.emptyItem)) break;
        const parentContentIndent = listStack.at(-2)?.contentIndent ?? 0;
        if (isSiblingListItem(top, parentContentIndent, markerIndent, delimiter)) break;
        listStack.pop();
      }
    }

    if (pendingBlanks > 0) {
      if (listStack.length > 0) {
        output.push(">");
      } else if (output.at(-1) !== "") {
        output.push("");
      }
      pendingBlanks = 0;
    }

    if (listMatch && delimiter) {
      const top = listStack.at(-1);
      const parentContentIndent = listStack.at(-2)?.contentIndent ?? 0;
      const sibling = top !== undefined && isSiblingListItem(top, parentContentIndent, markerIndent, delimiter);
      const baseIndent = sibling ? parentContentIndent : (top?.contentIndent ?? 0);
      if (markerIndent <= baseIndent + 3) {
        const rest = line.slice(listMatch[0].length);
        const emptyItem = rest.trim().length === 0;
        const contentIndent = listMatch[4] ? indentWidth(listMatch[0]) : indentWidth(listMatch[0]) + 1;
        if (sibling) {
          top.markerIndent = markerIndent;
          top.contentIndent = contentIndent;
          top.emptyItem = emptyItem;
        } else {
          listStack.push({ markerIndent, contentIndent, delimiter, emptyItem });
        }
        if (tryOpenFence(rest, contentIndent, 3)) {
          fenceMaxIndent = contentIndent + 3;
        }
      }
    } else {
      const top = listStack.at(-1);
      if (top) top.emptyItem = false;
      const baseIndent = top?.contentIndent ?? 0;
      tryOpenFence(line, baseIndent, baseIndent + 3);
    }
    output.push(`> ${line}`);
  }

  return output.join("\n");
}
