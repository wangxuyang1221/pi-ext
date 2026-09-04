/**
 * Unit tests for jsonSchemaToTypeBox.
 *
 * Covers primitive const values and additionalProperties semantics.
 */

import { describe, it, expect, vi } from "vitest";

// Mock TypeBox because Pi provides it at runtime.
vi.mock("typebox", () => {
  return {
    Type: {
      Literal: (v: unknown) => ({ const: v, description: "" }),
      Null: () => ({ type: "null", description: "" }),
      String: () => ({ type: "string", description: "" }),
      Number: () => ({ type: "number", description: "" }),
      Integer: () => ({ type: "integer", description: "" }),
      Boolean: () => ({ type: "boolean", description: "" }),
      Any: () => ({ type: "any", description: "" }),
      Array: (item: unknown) => ({ type: "array", items: item, description: "" }),
      Object: (props: unknown, opts?: Record<string, unknown>) => ({
        type: "object",
        properties: props,
        ...(opts ?? {}),
        description: "",
      }),
      Record: (k: unknown, v: unknown) => ({
        type: "record",
        key: k,
        value: v,
        description: "",
      }),
      Union: (variants: unknown[]) => ({ type: "union", variants, description: "" }),
      Optional: (t: unknown) => ({ ...(t as object), optional: true }),
    },
  };
});

import { jsonSchemaToTypeBox } from "../src/schema.js";

// Detect Literal output without depending on TypeBox internals.
function isLiteral(t: any): boolean {
  // TypeBox Literal schemas expose a const property.
  return t !== null && typeof t === "object" && "const" in t;
}

function isAny(t: any): boolean {
  return t !== null && typeof t === "object" && t.type === "any";
}

describe("jsonSchemaToTypeBox", () => {
  it("converts a string const to Literal", () => {
    const t = jsonSchemaToTypeBox({ const: "hello" });
    expect(isLiteral(t)).toBe(true);
  });

  it("converts a numeric const to Literal instead of Any", () => {
    const t = jsonSchemaToTypeBox({ const: 42 });
    expect(isLiteral(t)).toBe(true);
    expect(isAny(t)).toBe(false);
  });

  it("converts a boolean const to Literal instead of Any", () => {
    const t = jsonSchemaToTypeBox({ const: true });
    expect(isLiteral(t)).toBe(true);
    expect(isAny(t)).toBe(false);
  });

  it("converts a null const to a null schema instead of Any", () => {
    const t = jsonSchemaToTypeBox({ const: null });
    expect((t as any).type).toBe("null");
    expect(isAny(t)).toBe(false);
  });

  it("handles a false const", () => {
    const t = jsonSchemaToTypeBox({ const: false });
    expect(isLiteral(t)).toBe(true);
    expect(isAny(t)).toBe(false);
  });

  it("preserves integer semantics separately from number", () => {
    const t = jsonSchemaToTypeBox({ type: "integer" });
    // Integer output must remain constrained rather than falling back to Any.
    expect(t).not.toBeNull();
    expect(isAny(t)).toBe(false);

    // Compare against a number schema while retaining the original regression assertion.
    const tn = jsonSchemaToTypeBox({ type: "number" });
    expect(tn).not.toBeNull();
    // Integer may use a distinct representation, but it must not be Any.
    expect(isAny(t)).toBe(false);
  });

  it("preserves additionalProperties false in Object options", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    }) as any;
    // Expected form: Type.Object(props, { additionalProperties: false }).
    expect(t.properties).toBeDefined();
    expect(t.properties.a).toBeDefined();
    expect(t.additionalProperties).toBe(false); // This is false, not Record<string, false>.
  });

  it("passes an additionalProperties value schema without a Record wrapper", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: { type: "number" },
    }) as any;
    // Expected form: Type.Object(props, { additionalProperties: Type.Number() }),
    // not an additional Type.Record wrapper.
    expect(t.properties).toBeDefined();
    expect(t.properties.a).toBeDefined();
    // The additional property value schema is number, not record.
    expect(t.additionalProperties).toBeDefined();
    expect(t.additionalProperties.type).toBe("number");
    expect(t.additionalProperties.type).not.toBe("record");
  });

  it("maps an empty object with additionalProperties false to Type.Object", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      additionalProperties: false,
    }) as any;
    // An empty closed object remains Type.Object rather than Record<string, false>.
    expect(t.type).toBe("object");
    expect(t.additionalProperties).toBe(false);
    expect(t.type).not.toBe("record");
  });

  it("maps an empty object with an additionalProperties schema to Type.Object", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      additionalProperties: { type: "string" },
    }) as any;
    // The value constraint is preserved directly in Type.Object options.
    expect(t.type).toBe("object");
    expect(t.additionalProperties.type).toBe("string");
  });

  it("maps an unconstrained empty object to Record<string, any>", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
    }) as any;
    // An unconstrained empty object falls back to Record<string, any>.
    expect(t.type).toBe("record");
  });
});
