import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
export type FastModeExtensionOptions = {
    /** Directory containing the extension entry point; used to detect project-local package installs. */
    extensionDir?: string;
    /** Test/advanced override for Pi's user-level agent directory. */
    agentDir?: string;
};
export declare function createPiFastModeExtension(options?: FastModeExtensionOptions): ExtensionFactory;
declare const piFastModeExtension: ExtensionFactory;
export default piFastModeExtension;
//# sourceMappingURL=index.d.ts.map