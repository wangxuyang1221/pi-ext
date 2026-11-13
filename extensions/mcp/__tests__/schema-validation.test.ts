import { describe, expect, it } from "vitest";
import { Compile } from "typebox/compile";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { jsonSchemaToTypeBox } from "../src/schema.js";
import type { JsonSchema } from "../src/types.js";

const exclusive: JsonSchema = {
  type: "number",
  minimum: 0,
  description: "Exactly one numeric branch",
  oneOf: [{ type: "number" }, { type: "integer" }],
};

describe("MCP oneOf validation", () => {
  it("requires exactly one branch and preserves sibling constraints", () => {
    const schema = jsonSchemaToTypeBox(exclusive);
    const validator = Compile(schema);
    expect(validator.Check(1.5)).toBe(true);
    expect(validator.Check(1)).toBe(false);
    expect(validator.Check({})).toBe(false);
    expect(validator.Check(-1.5)).toBe(false);
    expect(schema).toMatchObject({ description: exclusive.description, oneOf: exclusive.oneOf });
    expect(exclusive).not.toHaveProperty("~unsafe");
  });

  it("preserves exclusivity inside the real Pi argument validator", () => {
    const tool = {
      name: "exclusive",
      description: "MCP fixture",
      parameters: jsonSchemaToTypeBox({ type: "object", properties: { choice: exclusive }, required: ["choice"] }),
    };
    const call = (choice: number | Record<string, never>) => validateToolArguments(tool, {
      type: "toolCall", id: "call", name: tool.name, arguments: { choice },
    });
    expect(call(1.5)).toEqual({ choice: 1.5 });
    for (const value of [1, {}, -1.5]) expect(() => call(value)).toThrow();
  });

  it("keeps anyOf inclusive while handling a nested oneOf", () => {
    const validator = Compile(jsonSchemaToTypeBox({ anyOf: [exclusive, { const: "fallback" }] }));
    expect(validator.Check(1.5)).toBe(true);
    expect(validator.Check("fallback")).toBe(true);
    expect(validator.Check(1)).toBe(false);
    expect(Compile(jsonSchemaToTypeBox({ anyOf: [{ type: "number" }, { type: "integer" }] })).Check(1)).toBe(true);
  });
});
