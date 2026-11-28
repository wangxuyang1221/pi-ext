import { stripTerminalSequences } from "@earendil-works/pi-tui";

export function sanitizeStatus(raw: string): string {
  return stripTerminalSequences(raw)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:[.·⋅∙│|]\s*)+/u, "");
}
