import { dirname, isAbsolute } from "node:path";

export interface LoadedSkill {
  name: string;
  location: string;
  baseDir: string;
  body: string;
}

export interface SkillSnapshot {
  namespace: "pi-ext/skill-mentions";
  version: 1;
  requestId: string;
  task: string;
  skills: LoadedSkill[];
}

const opening = '<pi-ext-skill-mentions version="1">\n';
const closing = "\n</pi-ext-skill-mentions>";

/** Serialize one user request and its immutable skill bodies. */
export function encodeSnapshot(snapshot: SkillSnapshot): string {
  return opening + JSON.stringify(snapshot) + closing;
}

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Validate persisted data before it can affect display or history editing. */
export function isSkillSnapshot(value: unknown): value is SkillSnapshot {
  if (!exactObject(value, ["namespace", "version", "requestId", "task", "skills"]) || value.namespace !== "pi-ext/skill-mentions"
    || value.version !== 1 || typeof value.task !== "string" || typeof value.requestId !== "string"
    || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(value.requestId)
    || !Array.isArray(value.skills) || value.skills.length === 0) return false;
  const names = new Set<string>();
  for (const skill of value.skills) {
    if (!exactObject(skill, ["name", "location", "baseDir", "body"]) || typeof skill.name !== "string" || !skill.name
      || typeof skill.location !== "string" || !isAbsolute(skill.location) || skill.location.includes("\0")
      || skill.baseDir !== dirname(skill.location) || typeof skill.body !== "string" || names.has(skill.name)) return false;
    names.add(skill.name);
  }
  return true;
}

/** Decode only this extension's complete, versioned envelope. */
export function decodeSnapshot(text: string): SkillSnapshot | undefined {
  if (!text.startsWith(opening) || !text.endsWith(closing)) return;
  try {
    const value: unknown = JSON.parse(text.slice(opening.length, -closing.length));
    return isSkillSnapshot(value) ? value : undefined;
  }
  catch { return; }
}
