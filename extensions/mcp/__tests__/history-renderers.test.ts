import { describe, expect, it } from "vitest";
import { historyRenderers } from "../src/history-renderers.js";
const theme = { fg: (_c: string, text: string) => text, bold: (text: string) => text } as any;

describe("history renderers", () => {
  it("renders unresolved full names without guessing without providing an execution route", async () => {
    const tool = historyRenderers({ fullName: "mcp__a__b__c" });
    expect(tool.renderShell).toBe("self");
    expect(tool).not.toHaveProperty("execute");
    expect(tool).not.toHaveProperty("parameters");
    const context = { state: {}, isPartial: false, isError: false, lastComponent: undefined } as any;
    tool.renderResult!({ content: [{ type: "text", text: "ok" }], details: undefined }, { expanded: false, isPartial: false }, theme, context);
    expect(tool.renderCall!({}, theme, context).render(120)).toEqual(["⌁ Called mcp__a__b__c"]);
  });
});
