import type { ToolInfo } from "@earendil-works/pi-coding-agent";

export const fixtureToolInfo: Pick<ToolInfo, "exposure" | "sourceInfo"> = {
  exposure: "direct",
  sourceInfo: { path: "<inline:test>", source: "inline", scope: "temporary", origin: "top-level" },
};
