import type { ContextUsage, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";

export interface HeaderOptions {
  version: string;
  cwd: string;
  home?: string;
  userName?: string;
  getModelId: () => string | undefined;
  getThinkingLevel: () => string;
  getBranch?: () => string | null;
  getKeybindings?: () => Pick<KeybindingsManager, "getKeys"> | undefined;
  getTheme: () => Theme;
}

export interface FooterOptions {
  getRate?: () => string | undefined;
  cwd: string;
  home?: string;
  getModelId: () => string | undefined;
  getThinkingLevel: () => string;
  getContextUsage: () => Pick<ContextUsage, "percent"> | undefined;
  getBranch: () => string | null;
  getExtensionStatuses: () => ReadonlyMap<string, string>;
  isBashMode?: () => boolean;
  getKeybindings?: () => Pick<KeybindingsManager, "getKeys"> | undefined;
  getTheme: () => Theme;
}
