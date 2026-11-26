import assert from "node:assert/strict";
import { test } from "vitest";
import { JsonUnits, argumentUnits } from "../src/json-units.js";

function streamedMilli(json: string): number {
  const counter = new JsonUnits();
  return counter.push(json) + counter.flush();
}

test("JSON milli-token estimates normalize whitespace, escapes and surrogates independently of chunk boundaries", () => {
  const pairs: Array<[string, string]> = [
    [" {} \n\t", "{}"],
    [String.raw`"\u4e2d\u6587"`, '"中文"'],
    [String.raw`"\ud83d\ude00"`, '"😀"'],
    [String.raw` { "text" : "\n\/\u4e2d\u6587abc", "flag" : true } `, JSON.stringify({ text: "\n/中文abc", flag: true })],
    [String.raw`{"a": [1, 2, null, false], "b": "\t\r\b\f\\\""}`, JSON.stringify({ a: [1, 2, null, false], b: '\t\r\b\f\\"' })],
  ];

  for (const [raw, canonical] of pairs) {
    const expected = streamedMilli(canonical);
    for (let size = 1; size <= raw.length; size++) {
      const counter = new JsonUnits();
      let milli = 0;
      for (let i = 0; i < raw.length; i += size) milli += counter.push(raw.slice(i, i + size));
      milli += counter.flush();
      assert.equal(milli, expected, `${raw}, chunk ${size}`);
    }
  }
});

test("a unicode escape emits its decoded scalar weight only when its final hex digit arrives", () => {
  const counter = new JsonUnits();
  assert.deepEqual(
    [...String.raw`"\u4e2d"`].map(char => counter.push(char)),
    [450, 0, 0, 0, 0, 0, 800, 450],
  );
  // Surrogate pair in unicode escapes holds high surrogate until low surrogate completes.
  const emoji = new JsonUnits();
  assert.deepEqual(
    [...String.raw`"\ud83d\ude00"`].map(char => emoji.push(char)),
    [450, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1333, 450],
  );
});

test("iterative argumentUnits matches JsonUnits over JSON.stringify without allocating serialized output", () => {
  const payloads: Array<Record<string, unknown>> = [
    {},
    { value: "中文\n/", flag: true, count: 128, none: null },
    { nested: { list: [1, "😀", undefined, Number.NaN, { deep: "\uD83D" }] }, skipped: undefined },
    { custom: { toJSON: () => ({ ok: "速率" }) } },
  ];

  for (const payload of payloads) {
    assert.equal(argumentUnits(payload), streamedMilli(JSON.stringify(payload)));
  }

  // Circular objects stay safe and bounded.
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.ok(argumentUnits(cyclic) > 0);

  // toJSON receives the property/index key and is invoked exactly once per node.
  const calls: string[] = [];
  const payload = {
    nested: {
      toJSON(key: string) {
        calls.push(key);
        return { inner: [{ toJSON(innerKey: string) { calls.push(innerKey); return "ok"; } }] };
      },
    },
  };
  assert.equal(argumentUnits(payload), streamedMilli(JSON.stringify({ nested: { inner: ["ok"] } })));
  assert.deepEqual(calls, ["nested", "0"]);
});
