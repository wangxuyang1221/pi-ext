import { describe, expect, it } from "vitest";
import { historyTool } from "../src/history-tool.js";
const theme = { fg: (_c: string, text: string) => text, bold: (text: string) => text } as any;

describe("history tools", () => {
  it("renders unresolved full names without guessing and always rejects execution", async () => {
    const tool = historyTool({ fullName: "mcp__a__b__c" });
    expect(tool.renderShell).toBe("self");
    expect(tool.description).toBe("");
    expect(tool.promptSnippet).toBeUndefined();
    expect(tool.promptGuidelines).toBeUndefined();
    expect(tool.parameters).toMatchObject({ type: "object", properties: {} });
    const context = { state: {}, isPartial: false, isError: false, lastComponent: undefined } as any;
    tool.renderResult!({ content: [{ type: "text", text: "ok" }], details: undefined }, { expanded: false, isPartial: false }, theme, context);
    expect(tool.renderCall!({}, theme, context).render(120)).toEqual(["⌁ Called mcp__a__b__c"]);
    await expect(tool.execute("id", {}, undefined, undefined, {} as any)).rejects.toThrow("history-only");
  });
});
