import { describe, expect, it, vi } from "vitest";
import { cloneConfig } from "../src/config.js";
import {
  findMatchingTarget,
  applyFastModePayload,
  getFastModePayload,
  toModelRef,
} from "../src/payload.js";
import {
  canSetTuiStatus,
  clearFastStatus,
  getStatusText,
  updateFastStatus,
} from "../src/status.js";
import { STATUS_KEY, type FastModeConfig } from "../src/types.js";

const config: FastModeConfig = cloneConfig({
  enabled: true,
  targets: [
    { provider: "openai", model: "gpt-5.4", serviceTier: "priority" },
    { provider: "openai-codex", model: "gpt-5.5", serviceTier: "flex" },
    { provider: "openai-codex", model: "gpt-5.6-sol", serviceTier: "priority" },
    { provider: "anthropic", model: "claude", serviceTier: "priority" },
  ],
});

describe("model matching", () => {
  it("matches exact provider/model pairs", () => {
    expect(
      findMatchingTarget({ provider: "openai", id: "gpt-5.4" }, config.targets),
    ).toEqual({
      provider: "openai",
      model: "gpt-5.4",
      serviceTier: "priority",
    });
  });

  it("does not match provider mismatch", () => {
    expect(
      findMatchingTarget(
        { provider: "openai-codex", id: "gpt-5.4" },
        config.targets,
      ),
    ).toBeUndefined();
  });

  it("does not match model mismatch", () => {
    expect(
      findMatchingTarget({ provider: "openai", id: "gpt-4" }, config.targets),
    ).toBeUndefined();
  });

  it("does not match unsupported providers even when a target is present", () => {
    expect(
      findMatchingTarget(
        { provider: "anthropic", id: "claude" },
        config.targets,
      ),
    ).toBeUndefined();
  });

  it("converts Pi model objects to lightweight model refs", () => {
    expect(
      toModelRef({ provider: "openai", id: "gpt-5.4", name: "GPT" }),
    ).toEqual({
      provider: "openai",
      id: "gpt-5.4",
    });
    expect(toModelRef({ provider: "openai" })).toBeUndefined();
    expect(toModelRef(null)).toBeUndefined();
  });
});

describe("payload mutation", () => {
  it("applyFastModePayload injects service_tier while preserving existing fields", () => {
    const payload = { model: "gpt-5.4", messages: [], service_tier: "auto" };
    const mutated = applyFastModePayload(payload, "priority");

    expect(mutated).toEqual({
      model: "gpt-5.4",
      messages: [],
      service_tier: "priority",
    });
    expect(mutated).not.toBe(payload);
  });

  it("applyFastModePayload returns undefined for non-record payloads", () => {
    expect(applyFastModePayload(null, "priority")).toBeUndefined();
    expect(applyFastModePayload([], "priority")).toBeUndefined();
    expect(applyFastModePayload("payload", "priority")).toBeUndefined();
  });

  it("injects priority only when enabled and matched", () => {
    expect(
      getFastModePayload(
        config,
        { provider: "openai", id: "gpt-5.4" },
        { a: 1 },
      ),
    ).toEqual({
      a: 1,
      service_tier: "priority",
    });
  });

  it("uses target-specific serviceTier when configured", () => {
    expect(
      getFastModePayload(
        config,
        { provider: "openai-codex", id: "gpt-5.5" },
        { a: 1 },
      ),
    ).toEqual({ a: 1, service_tier: "flex" });
  });

  it("matches configured GPT-5.6 models", () => {
    expect(
      getFastModePayload(
        config,
        { provider: "openai-codex", id: "gpt-5.6-sol" },
        { a: 1 },
      ),
    ).toEqual({ a: 1, service_tier: "priority" });
  });

  it("does nothing when disabled", () => {
    expect(
      getFastModePayload(
        { ...config, enabled: false },
        { provider: "openai", id: "gpt-5.4" },
        { a: 1 },
      ),
    ).toBeUndefined();
  });

  it("does nothing when unmatched", () => {
    expect(
      getFastModePayload(
        config,
        { provider: "openai", id: "gpt-5.5" },
        { a: 1 },
      ),
    ).toBeUndefined();
  });
});

describe("status behavior", () => {
  it("returns fast when enabled and matched", () => {
    expect(getStatusText(config, { provider: "openai", id: "gpt-5.4" })).toBe(
      "fast",
    );
  });

  it("hides when disabled", () => {
    expect(
      getStatusText(
        { ...config, enabled: false },
        { provider: "openai", id: "gpt-5.4" },
      ),
    ).toBeUndefined();
  });

  it("hides when enabled but unmatched", () => {
    expect(
      getStatusText(config, { provider: "openai", id: "gpt-5.5" }),
    ).toBeUndefined();
  });

  it("publishes a composable footer status and clears the legacy widget", () => {
    const setStatus = vi.fn();
    const setWidget = vi.fn();
    const ctx = { hasUI: true, mode: "tui", ui: { setStatus, setWidget } };

    updateFastStatus(ctx, config, { provider: "openai", id: "gpt-5.4" });
    clearFastStatus(ctx);

    expect(setStatus).toHaveBeenNthCalledWith(1, STATUS_KEY, "fast");
    expect(setStatus).toHaveBeenNthCalledWith(2, STATUS_KEY, undefined);
    expect(setWidget).toHaveBeenNthCalledWith(1, STATUS_KEY, undefined, {
      placement: "belowEditor",
    });
    expect(setWidget).toHaveBeenNthCalledWith(2, STATUS_KEY, undefined, {
      placement: "belowEditor",
    });
    expect(setWidget.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });

  it("uses the TUI footer status when widgets are unavailable", () => {
    const setStatus = vi.fn();
    const ctx = { hasUI: true, mode: "tui", ui: { setStatus } };

    updateFastStatus(ctx, config, { provider: "openai", id: "gpt-5.4" });
    clearFastStatus(ctx);

    expect(setStatus).toHaveBeenNthCalledWith(1, STATUS_KEY, "fast");
    expect(setStatus).toHaveBeenNthCalledWith(2, STATUS_KEY, undefined);
  });

  it("sets undefined to hide when disabled or unmatched", () => {
    const setStatus = vi.fn();
    const ctx = { hasUI: true, mode: "tui", ui: { setStatus } };

    updateFastStatus(
      ctx,
      { ...config, enabled: false },
      { provider: "openai", id: "gpt-5.4" },
    );
    updateFastStatus(ctx, config, { provider: "openai", id: "gpt-5.5" });

    expect(setStatus).toHaveBeenNthCalledWith(1, STATUS_KEY, undefined);
    expect(setStatus).toHaveBeenNthCalledWith(2, STATUS_KEY, undefined);
  });

  it("does not update non-TUI, no-UI, or widget-only contexts", () => {
    const setStatus = vi.fn();
    const setWidget = vi.fn();

    expect(
      canSetTuiStatus({ hasUI: false, mode: "tui", ui: { setStatus } }),
    ).toBe(false);
    expect(
      canSetTuiStatus({ hasUI: true, mode: "print", ui: { setStatus } }),
    ).toBe(false);
    expect(
      canSetTuiStatus({ hasUI: true, mode: "tui", ui: { setWidget } }),
    ).toBe(false);

    updateFastStatus({ hasUI: false, mode: "tui", ui: { setStatus } }, config, {
      provider: "openai",
      id: "gpt-5.4",
    });
    updateFastStatus(
      { hasUI: true, mode: "print", ui: { setStatus } },
      config,
      {
        provider: "openai",
        id: "gpt-5.4",
      },
    );
    updateFastStatus(
      { hasUI: true, mode: "tui", ui: { setWidget } },
      config,
      { provider: "openai", id: "gpt-5.4" },
    );

    expect(setStatus).not.toHaveBeenCalled();
    expect(setWidget).not.toHaveBeenCalled();
  });
});
