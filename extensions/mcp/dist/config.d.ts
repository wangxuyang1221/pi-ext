import type { McpDiagnostics } from "./diagnostics.js";
import type { McpConfig, McpConfigLoadResult } from "./types.js";
export interface McpConfigLoaderDependencies {
    env?: Readonly<Record<string, string | undefined>>;
    homeDir?: string;
    exists?: (path: string) => boolean;
    readFile?: (path: string) => string;
    allowProjectConfig?: boolean;
}
export declare function loadMcpConfig(cwd: string, diagnostics?: McpDiagnostics, dependencies?: McpConfigLoaderDependencies): McpConfig | null;
export declare function loadMcpConfigResult(cwd: string, diagnostics?: McpDiagnostics, dependencies?: McpConfigLoaderDependencies): McpConfigLoadResult;
export declare function configTemplatePath(cwd: string): string;
//# sourceMappingURL=config.d.ts.map