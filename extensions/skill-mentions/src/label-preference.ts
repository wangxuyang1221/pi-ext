import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IconMode } from "./labels.js";

/** Read the preference without treating malformed or inaccessible settings as a successful load. */
export function loadIconPreference(path: string): IconMode {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "cube"; throw error; }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
    !("icon" in value) || (value.icon !== "cube" && value.icon !== "command")) throw new Error("Invalid skill label icon preference");
  return value.icon;
}

/** Replace the complete settings file only after the temporary write succeeds. */
export function saveIconPreference(path: string, icon: IconMode): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, icon }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
