import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";

import { ResponsiveLinesComponent } from "../src/responsive-lines.js";

test("responsive lines cache renders until width, renderer, or invalidation changes", () => {
  const firstRenderer = vi.fn((width: number) => [`first ${width}`, "x".repeat(width + 2)]);
  const component = new ResponsiveLinesComponent();
  component.setRenderer(firstRenderer);

  const first = component.render(8);
  const repeated = component.render(8);

  assert.equal(firstRenderer.mock.calls.length, 1);
  assert.equal(repeated, first);
  assert.deepEqual(first.map((line) => visibleWidth(line)), [7, 8]);

  component.render(6);
  assert.deepEqual(firstRenderer.mock.calls, [[8], [6]]);

  const secondRenderer = vi.fn((width: number) => [`second ${width}`]);
  component.setRenderer(secondRenderer);
  assert.deepEqual(component.render(8), ["second 8"]);
  assert.equal(secondRenderer.mock.calls.length, 1);

  component.invalidate();
  component.render(8);
  assert.equal(secondRenderer.mock.calls.length, 2);
});
