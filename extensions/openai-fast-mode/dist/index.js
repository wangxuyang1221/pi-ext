import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getFastCommandCompletions, parseFastCommand } from "./commands.js";
import { cloneConfig, loadConfigForScope, saveConfigToPath, syncSupportedTargets, } from "./config.js";
import { getFastModePayload, toModelRef } from "./payload.js";
import { clearFastStatus, updateFastStatus } from "./status.js";
const DEFAULT_EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
function notifyError(ctx, error) {
    if (!ctx.hasUI)
        return;
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(message, "error");
}
export function createPiFastModeExtension(options = {}) {
    const extensionDir = options.extensionDir ?? DEFAULT_EXTENSION_DIR;
    const agentDir = options.agentDir;
    return function piFastModeExtension(pi) {
        let config = cloneConfig();
        let configPath;
        let loadedCwd;
        let currentModel;
        async function loadForContext(ctx) {
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
        async function ensureLoaded(ctx) {
            if (!configPath || loadedCwd !== ctx.cwd) {
                await loadForContext(ctx);
            }
        }
        async function saveCurrent(ctx) {
            if (!configPath || loadedCwd !== ctx.cwd) {
                await loadForContext(ctx);
            }
            if (!configPath) {
                throw new Error("Fast Mode config path was not resolved");
            }
            await saveConfigToPath(configPath, config);
        }
        function refreshCurrentModel(ctx) {
            currentModel = toModelRef(ctx.model) ?? currentModel;
        }
        pi.registerFlag("fast", {
            description: "Start with Fast Mode enabled",
            type: "boolean",
            default: false,
        });
        pi.registerCommand("fast", {
            description: "Toggle Fast Mode. Usage: /fast [on|off|toggle]",
            getArgumentCompletions: getFastCommandCompletions,
            handler: async (args, ctx) => {
                try {
                    await ensureLoaded(ctx);
                    refreshCurrentModel(ctx);
                    config.enabled = parseFastCommand(args, config.enabled);
                    await saveCurrent(ctx);
                    updateFastStatus(ctx, config, currentModel);
                }
                catch (error) {
                    notifyError(ctx, error);
                }
            },
        });
        pi.on("session_start", async (_event, ctx) => {
            try {
                currentModel = toModelRef(ctx.model);
                await loadForContext(ctx);
                if (pi.getFlag("fast") === true) {
                    config.enabled = true;
                    await saveCurrent(ctx);
                }
                updateFastStatus(ctx, config, currentModel);
            }
            catch (error) {
                notifyError(ctx, error);
            }
        });
        pi.on("model_select", async (event, ctx) => {
            currentModel = toModelRef(event.model) ?? toModelRef(ctx.model);
            updateFastStatus(ctx, config, currentModel);
        });
        pi.on("before_provider_request", (event, ctx) => {
            const model = toModelRef(ctx.model) ?? currentModel;
            return getFastModePayload(config, model, event.payload);
        });
        pi.on("session_shutdown", async (_event, ctx) => {
            try {
                if (configPath) {
                    await saveConfigToPath(configPath, config);
                }
            }
            catch (error) {
                notifyError(ctx, error);
            }
            finally {
                clearFastStatus(ctx);
            }
        });
    };
}
const piFastModeExtension = createPiFastModeExtension();
export default piFastModeExtension;
//# sourceMappingURL=index.js.map