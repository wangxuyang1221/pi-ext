import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { validateModelReference } from "./model-reference.js";

export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface RoleSettings {
  description?: string;
  model?: string;
  thinkingLevel?: typeof thinkingLevels[number];
  fast?: boolean;
}

export interface RoleSnapshot {
  roles: ReadonlyMap<string, Readonly<RoleSettings>>;
  diagnostics: readonly string[];
}

/** Read one user-level snapshot for both tool discovery and spawn resolution. */
export function loadRoles(agentDir: string): RoleSnapshot {
  const roles = new Map<string, Readonly<RoleSettings>>();
  const diagnostics: string[] = [];
  const directory = join(agentDir, "agents");
  let files: Dirent[];
  try {
    files = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push(`${directory}: ${errorMessage(error)}`);
    return { roles, diagnostics };
  }
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!file.isFile() || !file.name.endsWith(".jsonc")) continue;
    try {
      const name = file.name.slice(0, -6);
      if (!name.trim()) throw new Error("Agent type must not be empty");
      const errors: ParseError[] = [];
      const value: unknown = parse(readFileSync(join(directory, file.name), "utf8"), errors, { allowTrailingComma: true });
      if (errors.length) throw new Error(errors.map(error => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join(", "));
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Role must be a JSON object");
      const settings = value as Record<string, unknown>;
      for (const key of Object.keys(settings)) {
        if (!["description", "model", "thinkingLevel", "fast"].includes(key)) throw new Error(`Unknown field: ${key}`);
      }
      if (settings.description !== undefined && typeof settings.description !== "string") throw new Error("description must be a string");
      validateModelReference(settings.model);
      if (settings.thinkingLevel !== undefined && !thinkingLevels.includes(settings.thinkingLevel as typeof thinkingLevels[number])) {
        throw new Error(`thinkingLevel must be one of ${thinkingLevels.join(", ")}`);
      }
      if (settings.fast !== undefined && typeof settings.fast !== "boolean") throw new Error("fast must be a boolean");
      roles.set(name, Object.freeze(settings as RoleSettings));
    } catch (error) {
      diagnostics.push(`${file.name}: ${errorMessage(error)}`);
    }
  }
  return { roles, diagnostics };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
