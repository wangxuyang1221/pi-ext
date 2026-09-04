import { type FastModeConfig, type FastTarget, type ResolvedConfigPath } from "./types.js";
export declare const DEFAULT_CONFIG: FastModeConfig;
export declare function cloneConfig(config?: FastModeConfig): FastModeConfig;
/** Keep the persisted toggle while replacing targets with this package's current list. */
export declare function syncSupportedTargets(config: FastModeConfig): FastModeConfig;
export declare function normalizeTargets(rawTargets: unknown): FastTarget[] | undefined;
/**
 * Convert arbitrary config input into a safe Fast Mode config.
 *
 * Invalid top-level values fall back entirely. Invalid or missing fields fall
 * back field-by-field, while an explicit empty targets array is preserved so a
 * user can opt out of every target in a scoped config.
 */
export declare function normalizeConfig(raw: unknown, fallback?: FastModeConfig): FastModeConfig;
export declare function parseConfigJson(json: string, fallback?: FastModeConfig): FastModeConfig;
export declare function getUserConfigPath(agentDir?: string): string;
export declare function getProjectConfigPath(cwd: string): string;
export declare function isProjectLocalExtension(extensionDir: string | undefined, cwd: string): boolean;
export type SelectConfigPathOptions = {
    cwd: string;
    extensionDir?: string;
    agentDir?: string;
    exists?: (path: string) => boolean;
};
export declare function selectConfigPath({ cwd, extensionDir, agentDir, exists, }: SelectConfigPathOptions): ResolvedConfigPath;
export type LoadConfigOptions = Omit<SelectConfigPathOptions, "exists"> & {
    fallback?: FastModeConfig;
};
export type LoadedConfig = ResolvedConfigPath & {
    config: FastModeConfig;
};
export declare function loadConfigFromPath(configPath: string, fallback?: FastModeConfig): Promise<FastModeConfig>;
export declare function loadConfigForScope(options: LoadConfigOptions): Promise<LoadedConfig>;
export declare function saveConfigToPath(configPath: string, config: FastModeConfig): Promise<void>;
export declare function saveConfigForScope(options: SelectConfigPathOptions, config: FastModeConfig): Promise<ResolvedConfigPath>;
//# sourceMappingURL=config.d.ts.map