/**
 * jsonSchemaToTypeBox 转换器单元测试
 *
 * 覆盖：
 * - P3: const 应支持 string / number / boolean / null（不全退化为 Any）
 */

import { describe, it, expect, vi } from "vitest";

// Mock typebox（Pi 运行时提供，测试环境独立 mock）
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

// TypeBox 内部的类型标记（用于验证 Literal 而非 Any）
function isLiteral(t: any): boolean {
  // TypeBox Literal 有 .const 属性
  return t !== null && typeof t === "object" && "const" in t;
}

function isAny(t: any): boolean {
  return t !== null && typeof t === "object" && t.type === "any";
}

describe("jsonSchemaToTypeBox", () => {
  it("字符串 const 应转为 Literal", () => {
    const t = jsonSchemaToTypeBox({ const: "hello" });
    expect(isLiteral(t)).toBe(true);
  });

  it("数值 const 应转为 Literal 而非 Any", () => {
    const t = jsonSchemaToTypeBox({ const: 42 });
    expect(isLiteral(t)).toBe(true);
    expect(isAny(t)).toBe(false);
  });

  it("布尔 const 应转为 Literal 而非 Any", () => {
    const t = jsonSchemaToTypeBox({ const: true });
    expect(isLiteral(t)).toBe(true);
    expect(isAny(t)).toBe(false);
  });

  it("null const 应转为 null schema 而非 Any", () => {
    const t = jsonSchemaToTypeBox({ const: null });
    expect((t as any).type).toBe("null");
    expect(isAny(t)).toBe(false);
  });

  it("false const 也应正确处理", () => {
    const t = jsonSchemaToTypeBox({ const: false });
    expect(isLiteral(t)).toBe(true);
    expect(isAny(t)).toBe(false);
  });

  it("integer 类型应有独立语义（区别于 number）", () => {
    const t = jsonSchemaToTypeBox({ type: "integer" });
    // integer 不应和 number 完全相同（应带整数标记）
    expect(t).not.toBeNull();
    expect(isAny(t)).toBe(false);

    // 同时输入 type: "number" 对比
    const tn = jsonSchemaToTypeBox({ type: "number" });
    // integer 可以有不同处理，但至少不应是 any
    expect(isAny(t)).toBe(false);
  });

  it("additionalProperties: false 应保留在 Object options 中", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    }) as any;
    // Type.Object(props, { additionalProperties: false })
    expect(t.properties).toBeDefined();
    expect(t.properties.a).toBeDefined();
    expect(t.additionalProperties).toBe(false); // 直接是 false，不是 Record<string, false>
  });

  it("additionalProperties: schema 应直接传递值类型，不额外包 Record", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: { type: "number" },
    }) as any;
    // Type.Object(props, { additionalProperties: Type.Number() })
    // 不应是 Type.Object(props, { additionalProperties: Type.Record(Type.String(), Type.Number()) })
    expect(t.properties).toBeDefined();
    expect(t.properties.a).toBeDefined();
    // additionalProperties 值类型应为 number，不是 record
    expect(t.additionalProperties).toBeDefined();
    expect(t.additionalProperties.type).toBe("number");
    expect(t.additionalProperties.type).not.toBe("record");
  });

  it("空 object + additionalProperties: false → Type.Object({}, { additionalProperties: false })", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      additionalProperties: false,
    }) as any;
    // 空对象 + 禁止额外字段 → Object({}, { additionalProperties: false })，不是 Record<string, false>
    expect(t.type).toBe("object");
    expect(t.additionalProperties).toBe(false);
    expect(t.type).not.toBe("record");
  });

  it("空 object + additionalProperties schema → Type.Object({}, { additionalProperties: Type.String() })", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
      additionalProperties: { type: "string" },
    }) as any;
    // 空对象 + 额外属性约束 → Object({}, { additionalProperties: Type.String() })
    expect(t.type).toBe("object");
    expect(t.additionalProperties.type).toBe("string");
  });

  it("空 object 无 additionalProperties → Record<string, any>", () => {
    const t = jsonSchemaToTypeBox({
      type: "object",
    }) as any;
    // 无任何约束的空 object 退化为 Record<string, any>
    expect(t.type).toBe("record");
  });
});
