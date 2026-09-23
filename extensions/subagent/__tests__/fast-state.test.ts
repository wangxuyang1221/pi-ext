import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
import { readFastState } from "../src/fast-state.js";

test("waits for registered state responses and defaults off when Fast is absent", async () => {
  const events = new EventEmitter();
  expect(await readFastState(events as any)).toBe(false);
  let release!: (value: boolean) => void;
  events.on("pi-fast-mode:get-state", request => request.promises.push(new Promise(resolve => { release = resolve; })));
  let completed = false;
  const response = readFastState(events as any).then(value => { completed = true; return value; });
  await Promise.resolve();
  expect(completed).toBe(false);
  release(true);
  expect(await response).toBe(true);
});

test("rejects ambiguous Fast owners instead of selecting a value", async () => {
  const events = new EventEmitter();
  events.on("pi-fast-mode:get-state", request => request.promises.push(Promise.resolve(true), Promise.resolve(false)));
  await expect(readFastState(events as any)).rejects.toThrow("Multiple Fast Mode extensions responded");
});
