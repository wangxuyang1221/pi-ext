/**
 * MCP JSON Schema → TypeBox Schema 转换器
 *
 * 将 MCP 工具返回的 JSON Schema 格式的 inputSchema
 * 转换为 Pi 的 TypeBox Schema，用于 registerTool().parameters
 */
import { Type } from "typebox";
/**
 * 将 JSON Schema 转换为 TypeBox Schema
 *
 * 支持的类型：
 * - string, number, integer, boolean
 * - object (with properties and required)
 * - array (with items)
 * - enum (const / enum)
 * - oneOf / anyOf
 *
 * @param schema - MCP 工具返回的 JSON Schema
 * @returns TypeBox TSchema 实例
 */
export function jsonSchemaToTypeBox(schema) {
    // 处理 oneOf / anyOf（视为 union）
    if (schema.oneOf && schema.oneOf.length > 0) {
        const variants = schema.oneOf.map((s) => jsonSchemaToTypeBox(s));
        // TypeBox Union 需要至少 2 个元素
        if (variants.length === 1) {
            return withMeta(variants[0], schema);
        }
        return withMeta(Type.Union(variants), schema);
    }
    if (schema.anyOf && schema.anyOf.length > 0) {
        const variants = schema.anyOf.map((s) => jsonSchemaToTypeBox(s));
        if (variants.length === 1) {
            return withMeta(variants[0], schema);
        }
        return withMeta(Type.Union(variants), schema);
    }
    // 处理枚举（const 或 enum）
    // 支持所有 JSON Schema 合法 const：string / number / boolean / null
    if (schema.const !== undefined) {
        return schema.const === null
            ? withMeta(Type.Null(), schema)
            : withMeta(Type.Literal(schema.const), schema);
    }
    if (schema.enum && schema.enum.length > 0) {
        const literals = schema.enum.map((e) => e === null ? Type.Null() : Type.Literal(e));
        const t = literals.length === 1
            ? literals[0]
            : Type.Union(literals);
        return withMeta(t, schema);
    }
    // 基本类型
    switch (schema.type) {
        case "string":
            return withMeta(Type.String(), schema);
        case "number":
            return withMeta(Type.Number(), schema);
        case "integer":
            return withMeta(Type.Integer(), schema);
        case "boolean":
            return withMeta(Type.Boolean(), schema);
        case "array": {
            const itemSchema = schema.items
                ? jsonSchemaToTypeBox(schema.items)
                : Type.Any();
            return withMeta(Type.Array(itemSchema), schema);
        }
        case "object": {
            const properties = {};
            const required = new Set(schema.required ?? []);
            if (schema.properties) {
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    const propType = jsonSchemaToTypeBox(propSchema);
                    // 不在 required 中的字段设为 Optional
                    properties[key] = required.has(key) ? propType : Type.Optional(propType);
                }
            }
            // 没有明确 type 但提供了 properties，视为 object
            if (Object.keys(properties).length > 0) {
                const objOptions = buildObjectOptions(schema);
                return withMeta(Type.Object(properties, objOptions), schema);
            }
            // 空的 object（无 properties）
            if (schema.additionalProperties !== undefined) {
                // 有额外属性约束时走 Type.Object({}, options)，避免 Record 语义错位
                const objOptions = buildObjectOptions(schema);
                return withMeta(Type.Object({}, objOptions), schema);
            }
            // 无任何约束 → Record<string, any>
            return withMeta(Type.Record(Type.String(), Type.Any()), schema);
        }
        default: {
            // 没有明确类型但有 properties → 视为 object
            if (schema.properties) {
                const properties = {};
                const required = new Set(schema.required ?? []);
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    const propType = jsonSchemaToTypeBox(propSchema);
                    properties[key] = required.has(key) ? propType : Type.Optional(propType);
                }
                const objOptions = buildObjectOptions(schema);
                return withMeta(Type.Object(properties, objOptions), schema);
            }
            // 无法识别的类型，回退为 Any
            return withMeta(Type.Any(), schema);
        }
    }
}
/**
 * 为 TypeBox schema 添加 description 元数据
 */
function withMeta(schema, jsonSchema) {
    if (jsonSchema.description) {
        schema.description = jsonSchema.description;
    }
    return schema;
}
/**
 * 构建 Type.Object 的第二个参数（options），
 * 处理 additionalProperties: false 或 additionalProperties: schema。
 */
function buildObjectOptions(schema) {
    if (schema.additionalProperties === undefined)
        return {};
    const constraint = buildAdditionalConstraint(schema);
    return { additionalProperties: constraint };
}
/**
 * 将 JsonSchema.additionalProperties 转为 TypeBox 约束：
 * - false → false（禁止额外字段）
 * - object (sub-schema) → 递归转换后的值类型（如 Type.Number()）
 *
 * 注意：这里直接返回【额外属性的值类型】本身，
 * 不包 Type.Record，因为 Type.Object({}, { additionalProperties }) 的
 * additionalProperties 参数接受的就是值类型。
 */
function buildAdditionalConstraint(schema) {
    if (schema.additionalProperties === false)
        return false;
    if (schema.additionalProperties &&
        typeof schema.additionalProperties === "object") {
        return jsonSchemaToTypeBox(schema.additionalProperties);
    }
    return undefined;
}
//# sourceMappingURL=schema.js.map