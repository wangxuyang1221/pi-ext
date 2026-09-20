import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { parseSkillBlock, stripFrontmatter, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { findReferences } from "./references.js";
import type { LoadedSkill, SkillSnapshot } from "./protocol.js";

/** Resolve complete references against Pi's inventory and read each skill once per request. */
export async function loadSnapshot(task: string, commands: SlashCommandInfo[], read: (path: string) => Promise<string> = path => readFile(path, "utf8")): Promise<SkillSnapshot | undefined> {
  if (task.startsWith("<pi-ext-skill-mentions") || task.startsWith("/skill:") || parseSkillBlock(task)) return;
  const inventory = new Map(commands.filter(command => command.source === "skill" && command.name.startsWith("skill:"))
    .map(command => [command.name.slice(6), command]));
  const names = new Set(findReferences(task).map(reference => reference.name));
  const skills: LoadedSkill[] = [];
  for (const name of names) {
    const location = inventory.get(name)?.sourceInfo.path;
    if (!location || !isAbsolute(location)) continue;
    try {
      const baseDir = dirname(location);
      const body = stripFrontmatter(await read(location)).trim();
      skills.push({ name, location, baseDir, body: `References are relative to ${baseDir}.\n\n${body}` });
    } catch {
      // Failed reads remain ordinary references in the untouched task text.
    }
  }
  return skills.length ? { namespace: "pi-ext/skill-mentions", version: 1, requestId: randomUUID(), task, skills } : undefined;
}
