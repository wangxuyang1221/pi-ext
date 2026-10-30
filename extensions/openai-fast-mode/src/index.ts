import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { getFastCommandCompletions, parseFastCommand } from "./commands.js";
import {
  cloneConfig,
  loadConfigForScope,
  saveConfigToPath,
  syncSupportedTargets,
} from "./config.js";
import { getFastModePayload, toModelRef } from "./payload.js";
import { clearFastStatus, updateFastStatus } from "./status.js";
import type { FastModeConfig, ModelRef } from "./types.js";

export type FastModeExtensionOptions = {
  /** Directory containing the extension entry point; used to detect project-local package installs. */
  extensionDir?: string;
  /** Test/advanced override for Pi's user-level agent directory. */
  agentDir?: string;
  /** Controlled launch environment; defaults to the process environment. */
  env?: Record<string, string | undefined>;
};

const SESSION_STATE_TYPE = "pi-fast-mode-session";

const DEFAULT_EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

function isUnsupportedFastError(message: string): boolean {
  if (
    /(?:^|\W)(?:unsupported_(?:service_tier|fast_mode)|(?:service_tier|fast_mode)_unsupported)(?:$|\W)/i.test(message)
  ) {
    return true;
  }
  return (
    /\b(?:service[_ -]?tier|fast mode|priority processing)\b/i.test(message) &&
    /\b(?:not supported|does not support|unsupported)\b/i.test(message)
  );
}

function notifyError(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  error: unknown,
): void {
  if (!ctx.hasUI) return;
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(message, "error");
}

export function createPiFastModeExtension(
  options: FastModeExtensionOptions = {},
): ExtensionFactory {
  const extensionDir = options.extensionDir ?? DEFAULT_EXTENSION_DIR;
  const agentDir = options.agentDir;
  const env = options.env ?? process.env;

  return function piFastModeExtension(pi: ExtensionAPI): void {
    let config: FastModeConfig = cloneConfig();
    let configPath: string | undefined;
    let loadedCwd: string | undefined;
    let childSession = false;
    let currentModel: ModelRef | undefined;
    const excludedCodexModels = new Set<string>();
    const pendingCodexFastModels = new Set<string>();

    async function loadForContext(
      ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
    ): Promise<void> {
      const sessionId = ctx.sessionManager?.getSessionId();
      let savedEnabled: boolean | undefined;
      const entries = ctx.sessionManager?.getEntries() ?? [];
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!;
        if (entry.type !== "custom" || entry.customType !== SESSION_STATE_TYPE) continue;
        const data = entry.data as { sessionId?: unknown; enabled?: unknown } | undefined;
        if (data?.sessionId === sessionId && typeof data?.enabled === "boolean") {
          savedEnabled = data.enabled;
          break;
        }
      }
      childSession = env.PI_SUBAGENT_PARENT !== undefined || savedEnabled !== undefined;
      if (childSession) {
        const launch = env.PI_SUBAGENT_LAUNCH ? JSON.parse(env.PI_SUBAGENT_LAUNCH) : {};
        config = cloneConfig();
        config.enabled = savedEnabled ?? (launch.fast === true);
        configPath = undefined;
        loadedCwd = ctx.cwd;
        if (savedEnabled === undefined) pi.appendEntry(SESSION_STATE_TYPE, { sessionId, enabled: config.enabled });
        return;
      }
      const loaded = await loadConfigForScope({
        cwd: ctx.cwd,
        extensionDir,
        agentDir,
      });

      config = syncSupportedTargets(loaded.config);
      configPath = loaded.path;
      loadedCwd = ctx.cwd;

      // Persist the package's current target list on every load so upgrades
      // automatically update existing config files without changing enabled.
      await saveConfigToPath(configPath, config);
    }

    async function ensureLoaded(
      ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
    ): Promise<void> {
      if ((!childSession && !configPath) || loadedCwd !== ctx.cwd) {
        await loadForContext(ctx);
      }
    }

    async function saveCurrent(
      ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
    ): Promise<void> {
      if ((!childSession && !configPath) || loadedCwd !== ctx.cwd) {
        await loadForContext(ctx);
      }

      if (childSession) {
        pi.appendEntry(SESSION_STATE_TYPE, { sessionId: ctx.sessionManager.getSessionId(), enabled: config.enabled });
        return;
      }
      if (!configPath) {
        throw new Error("Fast Mode config path was not resolved");
      }

      await saveConfigToPath(configPath, config);
    }

    function refreshCurrentModel(ctx: Pick<ExtensionContext, "model">): void {
      currentModel = toModelRef(ctx.model) ?? currentModel;
    }

    // Shared request contract with subagent, without cross-package source imports.
    pi.events.on("pi-fast-mode:get-state", (data) => {
      const request = data as { promises: Promise<boolean>[] };
      request.promises.push(Promise.resolve(config.enabled));
    });

    pi.registerFlag("fast", {
      description: "Start with Fast Mode enabled",
      type: "boolean",
      default: false,
    });

    pi.registerCommand("fast", {
      description: "Toggle Fast Mode. Usage: /fast [on|off|toggle]",
      getArgumentCompletions: getFastCommandCompletions,
      handler: async (
        args: string,
        ctx: ExtensionCommandContext,
      ): Promise<void> => {
        try {
          await ensureLoaded(ctx);
          refreshCurrentModel(ctx);
          config.enabled = parseFastCommand(args, config.enabled);
          await saveCurrent(ctx);
          updateFastStatus(ctx, config, currentModel, excludedCodexModels);
        } catch (error) {
          notifyError(ctx, error);
        }
      },
    });

    pi.on("session_start", async (_event, ctx) => {
      try {
        currentModel = toModelRef(ctx.model);
        excludedCodexModels.clear();
        pendingCodexFastModels.clear();
        await loadForContext(ctx);

        if (!childSession && pi.getFlag("fast") === true) {
          config.enabled = true;
          await saveCurrent(ctx);
        }

        updateFastStatus(ctx, config, currentModel, excludedCodexModels);
      } catch (error) {
        notifyError(ctx, error);
      }
    });

    pi.on("model_select", async (event, ctx) => {
      currentModel = toModelRef(event.model) ?? toModelRef(ctx.model);
      updateFastStatus(ctx, config, currentModel, excludedCodexModels);
    });

    pi.on("before_provider_request", (event, ctx) => {
      const model = toModelRef(ctx.model) ?? currentModel;
      const payload = getFastModePayload(
        config,
        model,
        event.payload,
        excludedCodexModels,
      );
      if (payload !== undefined && model?.provider === "openai-codex") {
        pendingCodexFastModels.add(model.id);
      }
      return payload;
    });

    pi.on("message_end", (event, ctx) => {
      const message = event.message;
      if (message.role !== "assistant" || message.provider !== "openai-codex") return;
      if (!pendingCodexFastModels.delete(message.model)) return;
      if (
        message.stopReason !== "error" ||
        !isUnsupportedFastError(message.errorMessage ?? "")
      ) return;
      if (excludedCodexModels.has(message.model)) return;

      excludedCodexModels.add(message.model);
      const activeModel = toModelRef(ctx.model) ?? currentModel;
      if (activeModel?.provider === "openai-codex" && activeModel.id === message.model) {
        updateFastStatus(ctx, config, activeModel, excludedCodexModels);
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Fast mode is not supported for openai-codex/${message.model}. ` +
            "This request failed. Retry to use standard mode for this model in this session.",
          "warning",
        );
      }
    });

    pi.on("session_shutdown", (_event, ctx) => {
      excludedCodexModels.clear();
      pendingCodexFastModels.clear();
      clearFastStatus(ctx);
    });
  };
}

const piFastModeExtension = createPiFastModeExtension();

export default piFastModeExtension;
