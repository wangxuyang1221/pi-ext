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
  private readonly snapshots = new Map<string, CodexExecutionOptions>();

  constructor(private readonly provide?: (ctx: ExtensionContext) => CodexExecutionOptions) {}

  clear(): void { this.snapshots.clear(); }

  get(ctx: ExtensionContext): CodexExecutionOptions {
    const trusted = ctx.isProjectTrusted?.() ?? false;
    const key = `${ctx.cwd}\0${trusted}`;
    const previous = this.snapshots.get(key);
    if (previous) return previous;
    const snapshot = this.provide ? { ...this.provide(ctx) } : this.read(ctx.cwd, trusted);
    this.snapshots.set(key, snapshot);
    return snapshot;
  }

  private read(cwd: string, projectTrusted: boolean): CodexExecutionOptions {
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
    // Match Pi's handling of unreadable/malformed scopes: ignore that scope.
    // The host reports its own settings diagnostics; never echo file contents here.
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
