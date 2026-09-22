import assert from "node:assert/strict";
import { test } from "vitest";
import { HERO_NAMES, allocateHeroName } from "../src/hero-names.js";

test("uses the fixed 32 unique titles and selects every remaining bare name", () => {
  assert.equal(HERO_NAMES.length, 32);
  assert.equal(new Set(HERO_NAMES).size, 32);
  for (const available of HERO_NAMES) {
    assert.equal(allocateHeroName(new Set(HERO_NAMES.filter(name => name !== available))), available);
  }
});

test("numbers exhausted titles while avoiding full legacy and numbered names", () => {
  const occupied = new Set<string>(HERO_NAMES);
  for (const name of HERO_NAMES) occupied.add(`${name} 2`);
  for (let index = 0; index < 96; index += 1) {
    const name = allocateHeroName(occupied);
    assert.ok(Number(name.split(" ").at(-1)) >= 3);
    assert.equal(occupied.has(name), false);
    occupied.add(name);
  }
});
