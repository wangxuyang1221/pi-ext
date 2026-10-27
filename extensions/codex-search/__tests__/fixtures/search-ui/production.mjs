import { setTimeout as delay } from "node:timers/promises";
import { createSearchRenderers } from "../../../src/renderers.ts";
import { SearchAnimations } from "../../../src/animation.ts";
import { CodexError, classifyError } from "../../../src/errors.ts";

// Fixtures use the production WebSearchDetails shape.
export function productionResult(queries, outcome = "success", elapsedMs = 0, completed) {
  const partial = completed !== undefined;
  const failed = outcome === "partial" ? 1 : 0;
  const successes = partial ? [] : queries.slice(0, queries.length - failed).map((query, index) => ({ query,
    text: `Offline response for query ${index + 1}.`,
    citations: outcome === "empty" ? [] : Array.from({ length: index === 0 ? 5 : 3 }, (_, n) => ({
      title: `Example source ${index * 3 + n + (index === 0 ? 1 : 3)} (fixture)`,
      url: `https://example.com/research/${index * 3 + n + (index === 0 ? 1 : 3)}`,
    })), searchCalls: [{ actionType: "search" }],
  }));
  const failures = failed ? [{ query: queries.at(-1), kind: "transport", message: "Search service unavailable (fixture)" }] : [];
  const details = { model: "fixture", api: "responses", freshness: "live", searchContextSize: "high", queryCount: queries.length,
    queries, failedQueryCount: failed, successes, failures, elapsedMs,
    ...(partial ? { partial: true, completed, total: queries.length } : {}),
  };
  const body = partial ? `Searching ${completed}/${queries.length}` : successes.map(item =>
    `Query: ${item.query}\n${item.text}\nSources:\n${item.citations.map(source => `${source.title}: ${source.url}`).join("\n")}`).join("\n\n");
  return { content: [{ type: "text", text: body }], details };
}
export function createProductionSearch() {
  const animations = new SearchAnimations();
  const failures = new Map();
  return {
    renderers: createSearchRenderers({ searchApi: "responses", defaultFreshness: "live", defaultSearchContextSize: "high" }, args => args.queries ?? [], animations),
    async run(id, { queries, outcome, signal, onUpdate, finish, stepMs = 900 }) {
      try {
        return await animations.run(id, true, signal, async () => {
          const start = Date.now();
          onUpdate?.(productionResult(queries, "success", 0, 0));
          if (finish) outcome = await finish;
          else for (let n = 1; n <= queries.length; n++) {
            await delay(stepMs, undefined, { signal });
            onUpdate?.(productionResult(queries, "success", Date.now() - start, n));
          }
          if (outcome === "timeout") throw new CodexError("timeout", "Request timed out");
          if (outcome === "error") throw new CodexError("transport", "Search service unavailable");
          if (outcome === "interrupted") throw new DOMException("Search cancelled", "AbortError");
          return productionResult(queries, outcome, Date.now() - start);
        });
      } catch (error) {
        failures.set(id, { kind: classifyError(error), cancelled: signal?.aborted === true || outcome === "interrupted" });
        throw error;
      }
    },
    result(event) {
      const failure = failures.get(event.toolCallId);
      failures.delete(event.toolCallId);
      if (failure && event.isError) return { details: { ...event.details, searchFailure: failure } };
    },
    dispose() { animations.dispose(); failures.clear(); },
  };
}
