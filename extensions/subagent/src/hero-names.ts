import { randomInt } from "node:crypto";

export const HERO_NAMES = [
  "Captain America", "Iron Man", "Thor", "She-Hulk", "Captain Marvel", "Black Panther",
  "Ghost Rider", "Blade", "Black Widow", "Doctor Strange", "Ant-Man", "Hulk", "Moon Knight",
  "Scarlet Witch", "Vision", "Wasp", "Hawkeye", "Quicksilver", "Spider-Woman", "Nova",
  "Professor X", "Cyclops", "Phoenix", "Angel", "Beast", "Iceman", "Colossus", "Nightcrawler",
  "Rogue", "Storm", "Wolverine", "Spider-Man",
] as const;

export function allocateHeroName(occupied: ReadonlySet<string>): string {
  const available = HERO_NAMES.filter(name => !occupied.has(name));
  if (available.length) return available[randomInt(available.length)]!;
  const hero = HERO_NAMES[randomInt(HERO_NAMES.length)]!;
  let suffix = 2;
  while (occupied.has(`${hero} ${suffix}`)) suffix += 1;
  return `${hero} ${suffix}`;
}
