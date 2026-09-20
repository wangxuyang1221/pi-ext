import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

describe("skill mentions package", () => {
  it("publishes and enables the compiled extension exactly once", () => {
    expect(manifest.files).toContain("extensions/skill-mentions/dist");
    expect(manifest.pi.extensions.filter((entry: string) => entry === "./extensions/skill-mentions/dist/index.js"))
      .toEqual(["./extensions/skill-mentions/dist/index.js"]);
  });
});
