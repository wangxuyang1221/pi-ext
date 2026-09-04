/**
 * Converts MCP JSON Schema definitions to TypeBox schemas.
 *
 * The resulting schema is suitable for Pi registerTool().parameters.
 */
import { type TSchema } from "typebox";
import type { JsonSchema } from "./types.js";
/**
 * Converts an MCP tool JSON Schema to a TypeBox schema.
 *
 * Supported forms include primitive types, objects, arrays, enums, const,
 * oneOf, and anyOf.
 *
 * @param schema - JSON Schema returned by an MCP tool.
 * @returns A TypeBox schema instance.
 */
export declare function jsonSchemaToTypeBox(schema: JsonSchema): TSchema;
//# sourceMappingURL=schema.d.ts.map