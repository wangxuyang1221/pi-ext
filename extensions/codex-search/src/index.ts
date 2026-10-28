import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "@earendil-works/pi-ai";
import {
  assertSupportedStandaloneCombination,
  classifyError,
  CodexError,
  createRefStore,
  createTransport,
  fetchCodexModels,
  runResponsesSearch,
  runStandaloneCommands,
  selectDefaultModel,
  type CodexCitation,
  type CodexErrorKind,
  type CodexSearchCall,
  type SearchContextSize,
  type StandaloneCommandsOptions,
} from "./codex.ts";
import { registerSettingsCommand } from "./command.ts";
import {
  STANDALONE_TOOL_NAME,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FRESHNESS,
  DEFAULT_SEARCH_CONTEXT_SIZE,
  type Freshness,
  isProjectTrustedContext,
  loadConfig,
  type ResolvedConfig,
} from "./config.ts";
import { resolveCodexAccountId } from "./pi-auth.ts";
import { createSearchRenderers, type SearchFailureMetadata } from "./renderers.ts";
import { SearchAnimations } from "./animation.ts";

const OPENAI_CODEX_PROVIDER = "openai-codex";

interface QuerySuccess {
  query: string;
  text: string;
  citations: CodexCitation[];
  searchCalls: CodexSearchCall[];
  refIds?: Record<string, string>;
  responseId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

interface QueryFailure {
  query: string;
  kind: CodexErrorKind;
  message: string;
}

interface StandaloneCallPlan {
  query: string;
  buildOptions: () => StandaloneCommandsOptions;
  openedUrl?: string;
}

interface WebSearchFailureDetail {
  kind: CodexErrorKind;
  message: string;
}

export interface WebSearchDetails {
  model: string;
  api: string;
  freshness: Freshness;
  searchContextSize: SearchContextSize;
  queryCount: number;
  queries: string[];
  failedQueryCount: number;
  successes: QuerySuccess[];
  failures: QueryFailure[];
  failure?: WebSearchFailureDetail;
  partial?: boolean;
  completed?: number;
  total?: number;
  elapsedMs?: number;
}

function buildToolDescription(config: ResolvedConfig): string {
  const toolName = config.toolName;
  if (config.searchApi === "standalone") {
    return `${toolName}: standalone webpage actions for explicit page inspection: open one URL, find text, click link ids, screenshot pages, or run finance/weather/sports/time lookups. Not for web search.`;
  }
  return `${toolName}: search the web using the configured ChatGPT Codex subscription.`;
}

function buildSearchParametersSchema(config: ResolvedConfig) {
  return Type.Object({
    queries: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: config.batchSize,
      description: `One or more search queries to run in parallel (max ${config.batchSize}).`,
    }),
    search_context_size: Type.Optional(
      StringEnum(["low", "medium", "high"] as const, {
        description: "Amount of web context to retrieve. Defaults to medium.",
      }),
    ),
    freshness: Type.Optional(
      StringEnum(["cached", "indexed", "live"] as const, {
        description:
          "Use 'live' for time-sensitive queries; 'indexed' for OpenAI-indexed web access; 'cached' for stable topics. Defaults to live.",
      }),
    ),
  });
}

const StandaloneParametersSchema = Type.Object({
  search_context_size: Type.Optional(
    StringEnum(["medium", "high"] as const, {
      description:
        'Amount of web context to retrieve. Defaults to medium. Standalone mode disables "low".',
    }),
  ),
  freshness: Type.Optional(
    StringEnum(["cached", "indexed", "live"] as const, {
      description:
        "Use 'live' for time-sensitive queries; 'indexed' for OpenAI-indexed web access; 'cached' for stable topics. Defaults to live.",
    }),
  ),
  urls: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 1,
      description: "One URL to open/fetch directly.",
    }),
  ),
  find: Type.Optional(
    Type.Array(
      Type.Object({
        url: Type.String({ minLength: 1 }),
        pattern: Type.String({ minLength: 1 }),
      }),
      { maxItems: 1, description: "Find a pattern within a previously opened webpage." },
    ),
  ),
  click: Type.Optional(
    Type.Array(
      Type.Object({
        url: Type.String({ minLength: 1 }),
        id: Type.Integer({ minimum: 0 }),
      }),
      { maxItems: 1, description: "Follow one link id from a previously opened page." },
    ),
  ),
  screenshot: Type.Optional(
    Type.Array(
      Type.Object({
        url: Type.String({ minLength: 1 }),
        pageno: Type.Integer({ minimum: 0 }),
      }),
      { maxItems: 1, description: "Capture one screenshot of a previously opened page." },
    ),
  ),
  finance: Type.Optional(
    Type.Array(
      Type.Object({
        ticker: Type.String({ minLength: 1 }),
        type: StringEnum(["equity", "fund", "crypto", "index"] as const),
        market: Type.Optional(Type.String()),
      }),
      { maxItems: 1, description: "Look up one stock/ETF/crypto/index price." },
    ),
  ),
  weather: Type.Optional(
    Type.Array(
      Type.Object({
        location: Type.String({ minLength: 1 }),
        start: Type.Optional(Type.String()),
        duration: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      { maxItems: 1, description: "Look up one weather forecast." },
    ),
  ),
  sports: Type.Optional(
    Type.Array(
      Type.Object({
        fn: StringEnum(["schedule", "standings"] as const),
        league: StringEnum([
          "nba",
          "wnba",
          "nfl",
          "nhl",
          "mlb",
          "epl",
          "ncaamb",
          "ncaawb",
          "ipl",
        ] as const),
        team: Type.Optional(Type.String()),
        opponent: Type.Optional(Type.String()),
        date_from: Type.Optional(Type.String()),
        date_to: Type.Optional(Type.String()),
        num_games: Type.Optional(Type.Integer({ minimum: 0 })),
        locale: Type.Optional(Type.String()),
      }),
      { maxItems: 1, description: "Look up one sports schedule or standings request." },
    ),
  ),
  time: Type.Optional(
    Type.Array(
      Type.Object({
        utc_offset: Type.String({ minLength: 1 }),
      }),
      { maxItems: 1, description: "Get time for one UTC offset." },
    ),
  ),
});

type StandaloneParameters = Static<typeof StandaloneParametersSchema>;

type ToolParameters = Partial<
  Omit<StandaloneParameters, "queries" | "search_context_size" | "freshness">
> & {
  queries?: string[];
  image_queries?: string[];
  search_context_size?: SearchContextSize;
  freshness?: Freshness;
};

function buildToolParameters(config: ResolvedConfig) {
  return config.searchApi === "standalone"
    ? StandaloneParametersSchema
    : buildSearchParametersSchema(config);
}

function buildTool(config: ResolvedConfig, animations: SearchAnimations, saveFailure?: (id: string, failure: SearchFailureMetadata["searchFailure"]) => void) {
  const tool = defineTool({
    name: config.toolName,
    label: config.searchApi === "standalone" ? "Codex Standalone Web" : "Web Search",
    description: buildToolDescription(config),
    promptSnippet:
      config.searchApi === "standalone"
        ? `${config.toolName}: use only for explicit standalone webpage actions: open one URL, find text in that opened page, follow page link ids, take screenshots, or run finance/weather/sports/time lookups. Do not use for web search.`
        : `${config.toolName}: search the web using the configured ChatGPT Codex subscription.`,
    promptGuidelines:
      config.searchApi === "standalone"
        ? [
            `Use ${config.toolName} only when the user explicitly asks to open, read, inspect, find within, click inside, screenshot, or run finance/weather/sports/time lookup actions.`,
            "Do not use codex_standalone_web for ordinary web search, source gathering, or batches; use codex_search for search queries.",
            "Send exactly one standalone action per tool call. Do not combine urls/find/click/screenshot/lookup actions in one call.",
            "For webpage workflows, first open one exact URL with urls. After a successful open, do not open the same page again unless the user asks to reload it.",
            "For follow-up find/click/screenshot, use the same URL string the user opened. Do not switch between www and non-www hosts, add/remove trailing paths, or upgrade search_context_size just to retry.",
            "Do not use search_context_size low in standalone; use medium unless the user explicitly asks for high.",
            "If a follow-up page action fails because the page was not opened in this session, open the exact requested URL once, then retry the follow-up once.",
            "Do not ask the user for an access token; the tool uses pi's configured OpenAI Codex subscription.",
          ]
        : [
            `Use ${config.toolName} when current or source-backed information is needed.`,
            `Batch up to ${config.batchSize} related queries in one call when grouped comparison matters; use separate calls when independent results unblock the next step.`,
            config.standaloneEnabled
              ? "Use codex_standalone_web only when the user explicitly asks to open/read/inspect a webpage, find text inside an opened page, click a page link id, take a screenshot, or run finance/weather/sports/time lookups."
              : "codex_standalone_web is not enabled in this session; if the user asks for webpage actions, say that the Standalone web tool must be enabled in /codex-search-settings.",
            "Do not call codex_standalone_web merely to improve or duplicate a codex_search result.",
            "Choose freshness per request: use 'live' for news, prices, releases, availability, laws, schedules, or other time-sensitive facts; use 'cached' for stable facts and docs; use 'indexed' when OpenAI-indexed web access is enough but live browsing is not needed.",
            "Do not ask the user for an access token; the tool uses pi's configured OpenAI Codex subscription.",
          ],
    parameters: buildToolParameters(config),

    async execute(_toolCallId, params: ToolParameters, signal, onUpdate, ctx) {
      const sessionDir = config.searchApi === "standalone" ? ctx.sessionManager.getSessionDir() : undefined;
      const sessionId = ctx.sessionManager.getSessionId();
      const queries = params.queries?.map((q) => q.trim()).filter((q) => q.length > 0) ?? [];
      const imageQueries =
        params.image_queries?.map((q) => q.trim()).filter((q) => q.length > 0) ?? [];
      const urls = params.urls?.map((u) => u.trim()).filter((u) => u.length > 0) ?? [];
      const findCommands = params.find?.filter((c) => c.url.trim() && c.pattern.trim()) ?? [];
      const clickCommands = params.click?.filter((c) => c.url.trim()) ?? [];
      const screenshotCommands = params.screenshot?.filter((c) => c.url.trim()) ?? [];
      const financeCommands = params.finance ?? [];
      const weatherCommands = params.weather ?? [];
      const sportsCommands = params.sports ?? [];
      const timeCommands = params.time?.map((c) => ({ utc_offset: c.utc_offset })) ?? [];
      if (
        queries.length === 0 &&
        imageQueries.length === 0 &&
        urls.length === 0 &&
        findCommands.length === 0 &&
        clickCommands.length === 0 &&
        screenshotCommands.length === 0 &&
        financeCommands.length === 0 &&
        weatherCommands.length === 0 &&
        sportsCommands.length === 0 &&
        timeCommands.length === 0
      ) {
        throw new CodexError(
          "schema",
          "At least one query, url, page action, or lookup command is required",
        );
      }

      const startedAt = Date.now();
      const initialTotal = buildCallLabels(params).length;
      onUpdate?.({
        content: [{ type: "text", text: formatProgress(0, initialTotal) }],
        details: buildDetails(config, config.model ?? "", params.freshness ?? config.defaultFreshness,
          params.search_context_size ?? config.defaultSearchContextSize, [], [], {
            partial: true, completed: 0, total: initialTotal, elapsedMs: 0,
          }),
      });

      const token = await ctx.modelRegistry.getApiKeyForProvider(OPENAI_CODEX_PROVIDER);
      if (!token) {
        const err = new CodexError(
          "auth",
          "OpenAI Codex subscription is not configured. Run `/login openai-codex` and choose ChatGPT Plus/Pro.",
        );
        throw err;
      }

      const accountId = resolveCodexAccountId(token, ctx.modelRegistry);
      if (!accountId) {
        throw new CodexError(
          "auth",
          "OpenAI Codex account id was not found in stored credentials or access token. Re-run `/login openai-codex`.",
        );
      }

      const model = await resolveSearchModel(ctx, token, accountId, config, signal);
      const freshness = params.freshness ?? config.defaultFreshness;
      let searchContextSize = params.search_context_size ?? config.defaultSearchContextSize;
      if (config.searchApi === "standalone") {
        if (params.search_context_size === "low") {
          assertSupportedStandaloneCombination("low", freshness);
        }
        if (searchContextSize === "low") searchContextSize = "medium";
        assertSupportedStandaloneCombination(searchContextSize, freshness);
      }

      const transport = createTransport({
        token,
        accountId,
        baseUrl: config.baseUrl,
      });

      if (config.searchApi === "standalone") {
        if (queries.length > 0 || imageQueries.length > 0) {
          throw new CodexError(
            "schema",
            "codex_standalone_web does not support search or image search queries. Use codex_search for web search.",
          );
        }
        const refStore = createRefStore();
        await refStore.load(sessionDir!, sessionId);

        const baseStandaloneOptions = {
          model,
          transport,
          sessionId,
          freshness,
          searchContextSize,
          maxOutputTokens: 8000,
          signal,
        };
        const standaloneCalls: StandaloneCallPlan[] = [
          ...queries.map((q) => ({
            query: q,
            buildOptions: () => ({ ...baseStandaloneOptions, searchQuery: [{ q }] }),
          })),
          ...imageQueries.map((q) => ({
            query: `image: ${q}`,
            buildOptions: () => ({ ...baseStandaloneOptions, imageQuery: [{ q }] }),
          })),
          ...urls.map((url) => ({
            query: `open: ${url}`,
            openedUrl: url,
            buildOptions: () => ({
              ...baseStandaloneOptions,
              open: [{ refId: refStore.resolveRefId(url) ?? url }],
            }),
          })),
          ...findCommands.map((c: { url: string; pattern: string }) => ({
            query: `find "${c.pattern}" in ${c.url}`,
            buildOptions: () => ({
              ...baseStandaloneOptions,
              find: [
                {
                  refId: resolveStandalonePageRef(refStore, c.url, "find"),
                  pattern: c.pattern,
                },
              ],
            }),
          })),
          ...clickCommands.map((c: { url: string; id: number }) => ({
            query: `click ${c.id} in ${c.url}`,
            buildOptions: () => ({
              ...baseStandaloneOptions,
              click: [{ refId: resolveStandalonePageRef(refStore, c.url, "click"), id: c.id }],
            }),
          })),
          ...screenshotCommands.map((c: { url: string; pageno: number }) => ({
            query: `screenshot ${c.pageno} of ${c.url}`,
            buildOptions: () => ({
              ...baseStandaloneOptions,
              screenshot: [
                {
                  refId: resolveStandalonePageRef(refStore, c.url, "screenshot"),
                  pageno: c.pageno,
                },
              ],
            }),
          })),
          ...financeCommands.map((c) => ({
            query: `finance: ${c.ticker}`,
            buildOptions: () => ({ ...baseStandaloneOptions, finance: [c] }),
          })),
          ...weatherCommands.map((c) => ({
            query: `weather: ${c.location}`,
            buildOptions: () => ({ ...baseStandaloneOptions, weather: [c] }),
          })),
          ...sportsCommands.map((c) => ({
            query: `sports: ${c.fn} ${c.league}${c.team ? ` ${c.team}` : ""}`,
            buildOptions: () => ({ ...baseStandaloneOptions, sports: [c] }),
          })),
          ...timeCommands.map((c) => ({
            query: `time: ${c.utc_offset}`,
            buildOptions: () => ({ ...baseStandaloneOptions, time: [c] }),
          })),
        ];

        const total = standaloneCalls.length;
        if (total > 1) {
          throw new CodexError(
            "schema",
            `${config.toolName} accepts exactly one standalone action per tool call. Split the request or use codex_search for batched search.`,
          );
        }
        let completed = 0;
        const emitPartial = (partialText: string) => {
          onUpdate?.({
            content: [{ type: "text", text: partialText }],
            details: buildDetails(config, model, freshness, searchContextSize, [], [], {
              partial: true,
              completed,
              total,
              elapsedMs: Date.now() - startedAt,
            }),
          });
        };
        if (total > 1) emitPartial(formatProgress(completed, total));

        const successes: QuerySuccess[] = [];
        const failures: QueryFailure[] = [];
        for (const call of standaloneCalls) {
          try {
            const result = await runStandaloneCommands(call.buildOptions());
            if (call.openedUrl) {
              const refId = selectStandalonePageRefId(result.refIds);
              if (refId) await refStore.remember(call.openedUrl, refId);
            }
            const success: QuerySuccess = {
              query: call.query,
              text: result.text,
              citations: result.citations,
              searchCalls: result.searchCalls,
            };
            if (result.refIds) success.refIds = result.refIds;
            if (result.usage) success.usage = result.usage;
            successes.push(success);
          } catch (error) {
            const kind = classifyError(error);
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ query: call.query, kind, message });
          } finally {
            completed += 1;
            if (total > 1) emitPartial(formatProgress(completed, total));
          }
        }

        if (successes.length === 0) {
          const primary = failures[0];
          const summary =
            failures.length === 1
              ? (primary?.message ?? "Codex standalone request failed")
              : `All ${failures.length} ${config.toolName} standalone actions failed: ${failures
                  .map((f, i) => `${i + 1}. [${f.kind}] ${f.message}`)
                  .join("; ")}`;
          const err = new CodexError(primary?.kind ?? "unknown", summary) as CodexError & {
            failures?: QueryFailure[];
          };
          err.failures = failures;
          throw err;
        }

        return {
          content: [{ type: "text", text: formatToolText(successes, failures) }],
          details: buildDetails(config, model, freshness, searchContextSize, successes, failures, {
            elapsedMs: Date.now() - startedAt,
          }),
        };
      }

      // Responses API path: only search queries are supported.
      if (
        urls.length > 0 ||
        findCommands.length > 0 ||
        clickCommands.length > 0 ||
        screenshotCommands.length > 0 ||
        imageQueries.length > 0 ||
        financeCommands.length > 0 ||
        weatherCommands.length > 0 ||
        sportsCommands.length > 0 ||
        timeCommands.length > 0
      ) {
        throw new CodexError(
          "schema",
          `Open webpage and domain lookups require codex_standalone_web. Current tool is codex_search. Search requests should stay on codex_search.`,
        );
      }

      const total = queries.length;
      let completed = 0;
      let streamedText = "";

      const emitPartial = (partialText: string) => {
        onUpdate?.({
          content: [{ type: "text", text: partialText }],
          details: buildDetails(config, model, freshness, searchContextSize, [], [], {
            partial: true,
            completed,
            total,
            elapsedMs: Date.now() - startedAt,
          }),
        });
      };

      if (total > 1) emitPartial(formatProgress(completed, total));

      const settled = await Promise.allSettled(
        queries.map(async (query: string) => {
          const onTextDelta =
            total === 1
              ? (delta: string) => {
                  streamedText += delta;
                  emitPartial(streamedText);
                }
              : undefined;
          try {
            return await runResponsesSearch({
              query,
              model,
              transport,
              externalWebAccess: freshness !== "cached",
              indexedWebAccess: freshness === "indexed" ? true : undefined,
              searchContextSize,
              sessionId,
              threadId: ctx.sessionManager.getSessionId(),
              signal,
              onTextDelta,
            });
          } finally {
            completed += 1;
            if (total > 1) emitPartial(formatProgress(completed, total));
          }
        }),
      );

      const successes: QuerySuccess[] = [];
      const failures: QueryFailure[] = [];

      settled.forEach((outcome, index) => {
        const query = queries[index] ?? "";
        if (outcome.status === "fulfilled") {
          const success: QuerySuccess = {
            query,
            text: outcome.value.text,
            citations: outcome.value.citations,
            searchCalls: outcome.value.searchCalls,
          };
          if (outcome.value.responseId !== undefined) success.responseId = outcome.value.responseId;
          if (outcome.value.usage !== undefined) success.usage = outcome.value.usage;
          successes.push(success);
        } else {
          const reason = outcome.reason;
          const kind = classifyError(reason);
          const message = reason instanceof Error ? reason.message : String(reason);
          failures.push({ query, kind, message });
        }
      });

      if (successes.length === 0) {
        const primary = failures[0];
        const summary =
          failures.length === 1
            ? (primary?.message ?? "Codex web search failed")
            : `All ${failures.length} ${config.toolName} queries failed: ${failures
                .map((f, i) => `${i + 1}. [${f.kind}] ${f.message}`)
                .join("; ")}`;
        const err = new CodexError(primary?.kind ?? "unknown", summary) as CodexError & {
          failures?: QueryFailure[];
        };
        err.failures = failures;
        throw err;
      }

      return {
        content: [{ type: "text", text: formatToolText(successes, failures) }],
        details: buildDetails(config, model, freshness, searchContextSize, successes, failures, {
          elapsedMs: Date.now() - startedAt,
        }),
      };
    },

    ...createSearchRenderers(config, buildCallLabels, animations),
  });
  const execute = tool.execute;
  tool.execute = async (...args) => {
    try {
      return await animations.run(args[0], args[4].mode === "tui", args[2], () => execute(...args));
    } catch (error) {
      saveFailure?.(args[0], { kind: classifyError(error), cancelled: args[2]?.aborted === true });
      throw error;
    }
  };
  return tool;
}

export default function codexWebSearchExtension(pi: ExtensionAPI) {
  const animations = new SearchAnimations();
  const diagnostics = new Map<string, SearchFailureMetadata["searchFailure"]>();
  let generation = 0;
  // Interactive resume paints history before session_start. Register display definitions
  // synchronously, without reading project configuration or enabling tool execution.
  for (const searchApi of ["responses", "standalone"] as const) {
    const toolName = searchApi === "responses" ? "codex_search" : STANDALONE_TOOL_NAME;
    pi.registerTool({
      ...buildTool({ enabled: false, toolName, searchApi, standaloneEnabled: false,
        defaultFreshness: DEFAULT_FRESHNESS, defaultSearchContextSize: DEFAULT_SEARCH_CONTEXT_SIZE,
        batchSize: DEFAULT_BATCH_SIZE, sources: {} }, animations),
      exposure: "hidden",
      execute: async () => { throw new Error(`${toolName} is display-only until enabled by the session configuration.`); },
    });
  }
  registerSettingsCommand(pi);
  pi.on("session_shutdown", () => { generation++; diagnostics.clear(); animations.dispose(); });
  pi.on("agent_settled", () => diagnostics.clear());
  pi.on("tool_result", event => {
    if (event.toolName !== "codex_search") return;
    const failure = diagnostics.get(event.toolCallId);
    diagnostics.delete(event.toolCallId);
    if (!event.isError || !failure) return;
    // Add renderer-only metadata without replacing tool text or changing error semantics.
    return { details: { ...(event.details && typeof event.details === "object" ? event.details : {}), searchFailure: failure } };
  });

  pi.on("session_start", async (_event, ctx) => {
    const config = await loadConfig(ctx.cwd, isProjectTrustedContext(ctx));
    // Older hosts ignore exposure, so also remove disabled definitions from the model's tools.
    const disabledTools = new Set([
      ...(!config.enabled ? ["codex_search"] : []),
      ...(!config.enabled || !config.standaloneEnabled ? [STANDALONE_TOOL_NAME] : []),
    ]);
    pi.setActiveTools(pi.getActiveTools().filter(name => !disabledTools.has(name)));
    if (!config.enabled) return;

    const current = ++generation;
    pi.registerTool(buildTool({ ...config, searchApi: "responses", toolName: "codex_search" }, animations, (id, failure) => {
      if (current === generation) diagnostics.set(id, failure);
    }));
    if (config.standaloneEnabled) {
      pi.registerTool(
        buildTool({
          ...config,
          searchApi: "standalone",
          toolName: STANDALONE_TOOL_NAME,
          batchSize: 1,
        }, animations),
      );
    }
  });
}

async function resolveSearchModel(
  ctx: ExtensionContext,
  token: string,
  accountId: string,
  config: ResolvedConfig,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (config.model) return config.model;
  if (ctx.model?.provider === OPENAI_CODEX_PROVIDER) return ctx.model.id;

  const models = await fetchCodexModels({
    token,
    accountId,
    baseUrl: config.baseUrl,
    clientVersion: config.clientVersion,
    signal,
  });
  const model = selectDefaultModel(models);
  if (!model) {
    throw new CodexError("unknown", "Codex model list is empty.");
  }
  return model;
}

function buildDetails(
  config: ResolvedConfig,
  model: string,
  freshness: Freshness,
  searchContextSize: SearchContextSize,
  successes: QuerySuccess[],
  failures: QueryFailure[],
  extra?: { partial?: boolean; completed?: number; total?: number; elapsedMs?: number },
): WebSearchDetails {
  const queries = successes.map((s) => s.query).concat(failures.map((f) => f.query));
  return {
    model,
    api: config.searchApi,
    freshness,
    searchContextSize,
    queryCount: extra?.total ?? queries.length,
    queries,
    failedQueryCount: failures.length,
    successes,
    failures,
    ...extra,
  };
}

function formatProgress(completed: number, total: number): string {
  return `Searching ${completed}/${total} ${completed === total ? "complete" : "in progress"}`;
}

function formatToolText(successes: QuerySuccess[], failures: QueryFailure[]): string {
  const blocks: string[] = [];
  const total = successes.length + failures.length;
  const multiple = total > 1;

  for (const success of successes) {
    blocks.push(formatSuccessBlock(success, multiple));
  }
  for (const failure of failures) {
    blocks.push(formatFailureBlock(failure, multiple));
  }

  return blocks.join("\n\n");
}

function formatSuccessBlock(success: QuerySuccess, multiple: boolean): string {
  const text = success.text || "(no response text)";
  const sourceLines = success.citations.map((citation, index) => {
    const title = citation.title?.trim() || citation.url;
    return `${index + 1}. ${title}: ${citation.url}`;
  });
  const refLines = Object.keys(success.refIds ?? {}).map(
    (refId, index) => `${index + 1}. ${refId}`,
  );
  const sourceBlock = sourceLines.length > 0 ? `Sources:\n${sourceLines.join("\n")}` : "";
  const refBlock = refLines.length > 0 ? `Source refs:\n${refLines.join("\n")}` : "";
  const blocks = [text, sourceBlock, refBlock].filter((block) => block.length > 0);
  const body = blocks.join("\n\n");
  return multiple ? `## Query: ${success.query}\n\n${body}` : body;
}

function formatFailureBlock(failure: QueryFailure, multiple: boolean): string {
  const body = `[${failure.kind}] ${failure.message}`;
  return multiple ? `## Query: ${failure.query}\n\nFAILED: ${body}` : `FAILED: ${body}`;
}

function resolveStandalonePageRef(
  refStore: ReturnType<typeof createRefStore>,
  urlOrRef: string,
  action: string,
): string {
  const refId = refStore.resolveRefId(urlOrRef);
  if (refId) return refId;
  if (/^turn\d+(?:view|fetch)\d+$/.test(urlOrRef)) return urlOrRef;
  throw new CodexError(
    "schema",
    `${action} requires opening ${urlOrRef} with codex_standalone_web urls first in this session.`,
  );
}

export function selectStandalonePageRefId(
  refIds: Record<string, string> | undefined,
): string | undefined {
  const refs = Object.keys(refIds ?? {});
  return (
    refs.find((candidate) => /^turn\d+view\d+$/.test(candidate)) ??
    refs.find((candidate) => /^turn\d+fetch\d+$/.test(candidate))
  );
}

export function formatQueryPreviewLines(queries: unknown[], maxLength = 110): string[] {
  return queries.map(
    (query, index) =>
      `  ${index === queries.length - 1 ? "└" : "├"} ${formatInline(query, maxLength)}`,
  );
}

function buildRequestLabels(input: {
  queries: string[];
  imageQueries: string[];
  urls: string[];
  findCommands: Array<{ url: string; pattern: string }>;
  clickCommands: Array<{ url: string; id: number }>;
  screenshotCommands: Array<{ url: string; pageno: number }>;
  financeCommands: Array<{ ticker: string }>;
  weatherCommands: Array<{ location: string }>;
  sportsCommands: Array<{ fn: string; league: string; team?: string }>;
  timeCommands: Array<{ utc_offset: string }>;
}): string[] {
  return [
    ...input.queries,
    ...input.imageQueries.map((q) => `image: ${q}`),
    ...input.urls.map((url) => `open: ${url}`),
    ...input.findCommands.map((c) => `find "${c.pattern}" in ${c.url}`),
    ...input.clickCommands.map((c) => `click ${c.id} in ${c.url}`),
    ...input.screenshotCommands.map((c) => `screenshot ${c.pageno} of ${c.url}`),
    ...input.financeCommands.map((c) => `finance: ${c.ticker}`),
    ...input.weatherCommands.map((c) => `weather: ${c.location}`),
    ...input.sportsCommands.map((c) => `sports: ${c.fn} ${c.league}${c.team ? ` ${c.team}` : ""}`),
    ...input.timeCommands.map((c) => `time: ${c.utc_offset}`),
  ];
}

function buildCallLabels(args: Record<string, unknown>): string[] {
  return buildRequestLabels({
    queries: Array.isArray(args.queries) ? args.queries.filter(isString) : [],
    imageQueries: Array.isArray(args.image_queries) ? args.image_queries.filter(isString) : [],
    urls: Array.isArray(args.urls) ? args.urls.filter(isString) : [],
    findCommands: Array.isArray(args.find)
      ? args.find.filter(isFindArg).map((c) => ({ url: c.url, pattern: c.pattern }))
      : [],
    clickCommands: Array.isArray(args.click)
      ? args.click.filter(isClickArg).map((c) => ({ url: c.url, id: c.id }))
      : [],
    screenshotCommands: Array.isArray(args.screenshot)
      ? args.screenshot.filter(isScreenshotArg).map((c) => ({ url: c.url, pageno: c.pageno }))
      : [],
    financeCommands: Array.isArray(args.finance)
      ? args.finance.filter(isFinanceArg).map((c) => ({ ticker: c.ticker }))
      : [],
    weatherCommands: Array.isArray(args.weather)
      ? args.weather.filter(isWeatherArg).map((c) => ({ location: c.location }))
      : [],
    sportsCommands: Array.isArray(args.sports)
      ? args.sports.filter(isSportsArg).map((c) => ({ fn: c.fn, league: c.league, team: c.team }))
      : [],
    timeCommands: Array.isArray(args.time)
      ? args.time.filter(isTimeArg).map((c) => ({ utc_offset: c.utc_offset }))
      : [],
  });
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFindArg(value: unknown): value is { url: string; pattern: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string" &&
    typeof (value as { pattern?: unknown }).pattern === "string"
  );
}

function isClickArg(value: unknown): value is { url: string; id: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string" &&
    typeof (value as { id?: unknown }).id === "number"
  );
}

function isScreenshotArg(value: unknown): value is { url: string; pageno: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string" &&
    typeof (value as { pageno?: unknown }).pageno === "number"
  );
}

function isFinanceArg(value: unknown): value is { ticker: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ticker?: unknown }).ticker === "string"
  );
}

function isWeatherArg(value: unknown): value is { location: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { location?: unknown }).location === "string"
  );
}

function isSportsArg(value: unknown): value is { fn: string; league: string; team?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fn?: unknown }).fn === "string" &&
    typeof (value as { league?: unknown }).league === "string" &&
    ((value as { team?: unknown }).team === undefined ||
      typeof (value as { team?: unknown }).team === "string")
  );
}

function isTimeArg(value: unknown): value is { utc_offset: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { utc_offset?: unknown }).utc_offset === "string"
  );
}

function formatInline(value: unknown, maxLength = 90): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
