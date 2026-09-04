/**
 * Converts MCP JSON Schema definitions to TypeBox schemas.
 *
 * The resulting schema is suitable for Pi registerTool().parameters.
 */

import { Type, type TSchema } from "typebox";
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
export function jsonSchemaToTypeBox(schema: JsonSchema): TSchema {
  // Treat oneOf and anyOf as unions.
  if (schema.oneOf && schema.oneOf.length > 0) {
    const variants = schema.oneOf.map((s) => jsonSchemaToTypeBox(s));
    // TypeBox unions require at least two members.
    if (variants.length === 1) {
      return withMeta(variants[0], schema);
    }
    return withMeta(Type.Union(variants as [TSchema, TSchema, ...TSchema[]]), schema);
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const variants = schema.anyOf.map((s) => jsonSchemaToTypeBox(s));
    if (variants.length === 1) {
      return withMeta(variants[0], schema);
    }
    return withMeta(Type.Union(variants as [TSchema, TSchema, ...TSchema[]]), schema);
  }

  // Support every JSON Schema primitive accepted by const and enum.
  if (schema.const !== undefined) {
    return schema.const === null
      ? withMeta(Type.Null(), schema)
      : withMeta(Type.Literal(schema.const), schema);
  }
  if (schema.enum && schema.enum.length > 0) {
    const literals = schema.enum.map((e) =>
      e === null ? Type.Null() : Type.Literal(e)
    );
    const t =
      literals.length === 1
        ? literals[0]
        : Type.Union(literals as unknown as [TSchema, TSchema, ...TSchema[]]);
    return withMeta(t, schema);
  }

  // Convert primitive and container types.
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
        ? jsonSchemaToTypeBox(schema.items as JsonSchema)
        : Type.Any();
      return withMeta(Type.Array(itemSchema), schema);
    }
    case "object": {
      const properties: Record<string, TSchema> = {};
      const required = new Set(schema.required ?? []);

      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          const propType = jsonSchemaToTypeBox(propSchema as JsonSchema);
          // Properties absent from required are optional.
          properties[key] = required.has(key) ? propType : Type.Optional(propType);
        }
      }

      // A schema with properties is treated as an object.
      if (Object.keys(properties).length > 0) {
        const objOptions = buildObjectOptions(schema);
        return withMeta(Type.Object(properties, objOptions), schema);
      }

      // Preserve constraints on objects without declared properties.
      if (schema.additionalProperties !== undefined) {
        // Type.Object preserves additionalProperties value semantics.
        const objOptions = buildObjectOptions(schema);
        return withMeta(Type.Object({}, objOptions), schema);
      }
      // An unconstrained object maps to Record<string, any>.
      return withMeta(Type.Record(Type.String(), Type.Any()), schema);
    }
    default: {
      // Infer object semantics when type is omitted but properties exist.
      if (schema.properties) {
        const properties: Record<string, TSchema> = {};
        const required = new Set(schema.required ?? []);
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          const propType = jsonSchemaToTypeBox(propSchema as JsonSchema);
          properties[key] = required.has(key) ? propType : Type.Optional(propType);
        }
        const objOptions = buildObjectOptions(schema);
        return withMeta(Type.Object(properties, objOptions), schema);
      }
      // Unknown schema forms fall back to Any.
      return withMeta(Type.Any(), schema);
    }
  }
}

/** Adds JSON Schema description metadata to a TypeBox schema. */
function withMeta(schema: TSchema, jsonSchema: JsonSchema): TSchema {
  if (jsonSchema.description) {
    (schema as Record<string, unknown>).description = jsonSchema.description;
  }
  return schema;
}

/** Builds Type.Object options for additionalProperties constraints. */
function buildObjectOptions(schema: JsonSchema): Record<string, unknown> {
  if (schema.additionalProperties === undefined) return {};
  const constraint = buildAdditionalConstraint(schema);
  return { additionalProperties: constraint };
}

/**
 * Converts additionalProperties to the value constraint accepted by
 * Type.Object options. False rejects extra fields, while a sub-schema is
 * converted recursively without wrapping it in Type.Record.
 */
function buildAdditionalConstraint(schema: JsonSchema): unknown {
  if (schema.additionalProperties === false) return false;
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    return jsonSchemaToTypeBox(schema.additionalProperties as JsonSchema);
  }
  return undefined;
}
