import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME, getAgentDir, SettingsManager,
  type BashToolOptions, type ExtensionContext, type ReadToolOptions,
} from "@earendil-works/pi-coding-agent";

/** Explicit SDK options replace file settings; custom factories own their options. */
export interface CodexExecutionOptions {
  read?: ReadToolOptions;
  bash?: BashToolOptions;
}

/** One read-only settings snapshot per cwd and trust state, until session reload. */
export class ExecutionSettings {
  private readonly snapshots = new Map<string, CodexExecutionOptions | Error>();

  constructor(private readonly provide?: (ctx: ExtensionContext) => CodexExecutionOptions) {}

  clear(): void { this.snapshots.clear(); }

  get(ctx: ExtensionContext): CodexExecutionOptions {
    const trusted = ctx.isProjectTrusted?.() ?? false;
    const key = `${ctx.cwd}\0${trusted}`;
    let snapshot = this.snapshots.get(key);
    if (!snapshot) {
      snapshot = this.provide ? { ...this.provide(ctx) } : this.read(ctx.cwd, trusted);
      this.snapshots.set(key, snapshot);
    }
    if (snapshot instanceof Error) throw snapshot;
    return snapshot;
  }

  private read(cwd: string, projectTrusted: boolean): CodexExecutionOptions | Error {
    // FileSettingsStorage also takes filesystem locks when reading. Use the public
    // merge/migration logic with a read-only backend, without writes beside settings.
    const settings = SettingsManager.fromStorage({
      withLock(scope, inspect) {
        const path = scope === "global" ? join(getAgentDir(), "settings.json")
          : join(cwd, CONFIG_DIR_NAME, "settings.json");
        let content: string | undefined;
        try { content = readFileSync(path, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        inspect(content);
      },
    }, { projectTrusted });
    const errors = settings.drainErrors();
    if (errors.length) {
      // Reload replaces this instance, so the host's last valid settings are unavailable.
      // Cache a safe error instead of silently changing execution environments.
      const scopes = [...new Set(errors.map(error => error.scope))].join(", ");
      return new Error(`Cannot load ${scopes} execution settings. Tool execution blocked. Fix the settings file(s), then run /reload.`);
    }
    return {
      read: { autoResizeImages: settings.getImageAutoResize() },
      bash: { shellPath: settings.getShellPath(), commandPrefix: settings.getShellCommandPrefix() },
    };
  }
}

/** Cache configured definitions by snapshot; cleared snapshots are not retained. */
export function executionDefinitionCache<T>(settings: ExecutionSettings,
  factory: (cwd: string, options: CodexExecutionOptions) => T): (ctx: ExtensionContext) => T {
  const definitions = new WeakMap<CodexExecutionOptions, T>();
  return ctx => {
    const options = settings.get(ctx);
    if (definitions.has(options)) return definitions.get(options)!;
    const definition = factory(ctx.cwd, options);
    definitions.set(options, definition);
    return definition;
  };
}
