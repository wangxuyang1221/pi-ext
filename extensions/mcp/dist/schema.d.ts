/**
 * MCP JSON Schema → TypeBox Schema 转换器
 *
 * 将 MCP 工具返回的 JSON Schema 格式的 inputSchema
 * 转换为 Pi 的 TypeBox Schema，用于 registerTool().parameters
 */
import { type TSchema } from "typebox";
import type { JsonSchema } from "./types.js";
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
export declare function jsonSchemaToTypeBox(schema: JsonSchema): TSchema;
//# sourceMappingURL=schema.d.ts.map