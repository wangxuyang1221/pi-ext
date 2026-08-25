import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
interface PermissionsExtensionOptions {
    env?: Record<string, string | undefined>;
}
/**
 * Registers process-local permission modes and tool approval gates.
 *
 * @param pi - Pi extension API.
 * @param options - Optional environment override used by tests and embedded runtimes.
 */
export default function permissionsExtension(pi: ExtensionAPI, options?: PermissionsExtensionOptions): void;
export {};
//# sourceMappingURL=index.d.ts.map