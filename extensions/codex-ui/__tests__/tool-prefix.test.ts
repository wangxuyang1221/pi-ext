import { expect, test } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { toolStatusMarker, type ToolStatus } from "../../../shared/ui/tool-status.js";

const theme = { fg: (tone: string, text: string) => `<${tone}>${text}</${tone}>`, bold: (text: string) => text } as Theme;

test("uses category glyphs with accent pending and running, muted success and warning or error failures", () => {
  for (const glyph of ["$", "@", "~"]) {
    for (const [status, tone] of Object.entries({ pending: "accent", running: "accent", completed: "muted", failed: "error", interrupted: "warning", timed_out: "warning" })) {
      expect(toolStatusMarker(theme, status as ToolStatus, glyph)).toBe(`<${tone}>${glyph}</${tone}>`);
    }
  }
});
