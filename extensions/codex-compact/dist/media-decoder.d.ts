/** Decode using the same image-rs release as Codex; never access the network. */
export declare function decodeOriginalImageBytes(url: string, platform?: string): number | undefined;
/** Match hook XML using the exact quick-xml version used by Codex. */
export declare function isHookPrompt(text: string): boolean;
/** Validate Codex's serialized inter-agent communication, including paths. */
export declare function isInterAgentCommunication(text: string): boolean;
/** Read duration using Codex's Symphonia release and demuxer features. */
export declare function decodeAudioDuration(url: string): number | undefined;
//# sourceMappingURL=media-decoder.d.ts.map