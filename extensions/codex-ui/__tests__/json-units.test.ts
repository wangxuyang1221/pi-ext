import assert from "node:assert/strict";
import { test } from "vitest";
import { JsonUnits, argumentUnits } from "../src/json-units.js";

test("JSON estimates normalize whitespace and escapes independently of chunk boundaries", () => {
  const cases: Array<[string, number]> = [
    [' {} \n\t', 2], ['"abc def"', 9], ['"\\n\\t\\r\\b\\f\\/\\\\\\\""', 10],
    ['"\\u4e2d\\u6587"', 4], ['"中文"', 4], ['"\\ud83d\\ude00"', 4], ['"😀"', 4],
    ['{"a": [1, 2], "b":true}', 20],
  ];
  for (const [input, expected] of cases) {
    for (let size = 1; size <= input.length; size++) {
      const counter = new JsonUnits(); let units = 0;
      for (let i = 0; i < input.length; i += size) units += counter.push(input.slice(i, i + size));
      assert.equal(units, expected, `${input}, chunk ${size}`);
    }
  }
  assert.equal(argumentUnits({ value: "中文\n/" }), 16);
});

test("a unicode escape counts only when its final digit arrives", () => {
  const counter = new JsonUnits();
  assert.deepEqual([...String.raw`"\u4e2d"`].map(char => counter.push(char)), [1, 0, 0, 0, 0, 0, 1, 1]);
});
