import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type ContextSource = Pick<ExtensionContext, "sessionManager" | "model" | "getContextUsage">;

/** Reuse append-only context between frames; virtual routing keeps the live getter. */
export function createContextUsageReader(ctx: ContextSource): ExtensionContext["getContextUsage"] {
  let previous: readonly unknown[] = [];
  let value: ReturnType<ExtensionContext["getContextUsage"]>;
  return () => {
    const manager = ctx.sessionManager, model = ctx.model;
    // Pi 1.4 virtual limits also depend on live agent messages, beyond the persisted branch.
    if (!model || model.api === "pi-virtual" || typeof manager.getLeafEntry !== "function") return ctx.getContextUsage();
    const revision = [manager, manager.getLeafEntry(), model, model.contextWindow];
    if (!revision.every((part, index) => part === previous[index])) {
      value = ctx.getContextUsage();
      previous = revision;
    }
    return value;
  };
}
