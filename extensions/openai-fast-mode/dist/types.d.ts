export declare const PACKAGE_NAME = "pi-openai-fast-mode";
export declare const STATUS_KEY = "pi-openai-fast-mode";
export declare const DEFAULT_SERVICE_TIER = "priority";
export declare const SUPPORTED_PROVIDERS: readonly ["openai", "openai-codex"];
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];
export type FastTarget = {
    provider: string;
    model: string;
    serviceTier?: string;
};
export type FastModeConfig = {
    enabled: boolean;
    targets: FastTarget[];
};
export type ModelRef = {
    provider: string;
    id: string;
};
export type ConfigScope = "user" | "project";
export type ResolvedConfigPath = {
    scope: ConfigScope;
    path: string;
};
//# sourceMappingURL=types.d.ts.map