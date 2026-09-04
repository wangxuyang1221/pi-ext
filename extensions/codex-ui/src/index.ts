import { basename } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";

import { CodexEditor, CodexFooter, CodexHeader } from "./components.js";
import { registerCodexTools } from "./tools.js";

export const CODEX_THEME_NAME = "codex-pi";

const LOW_POWER_ARGUMENTS = ["on", "off", "status"] as const;
const TITLE_SPINNER_INTERVAL_MS = 500;
const TITLE_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const TITLE_DOT_FRAMES = [".", "..", "..."] as const;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function truncatePlainText(text: string, maxWidth: number): string {
  const safeWidth = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : 0;
  if (safeWidth === 0) return "";
  if (visibleWidth(text) <= safeWidth) return text;

  const ellipsis = "…";
  const contentWidth = Math.max(0, safeWidth - visibleWidth(ellipsis));
  let prefix = "";
  let prefixWidth = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
    const segmentWidth = visibleWidth(segment);
    if (prefixWidth + segmentWidth > contentWidth) break;
    prefix += segment;
    prefixWidth += segmentWidth;
  }
  return `${prefix}${ellipsis}`;
}

function compactThinkingMarkdown(markdown: string, availableWidth: number): string {
  const latestParagraph = markdown.trim().split(/\n\s*\n/u).at(-1) ?? "";
  const singleLine = latestParagraph.replace(/\s+/gu, " ").trim();
  if (availableWidth <= 0) return "";

  for (const marker of ["**", "__"] as const) {
    if (singleLine.startsWith(marker) && singleLine.endsWith(marker) && singleLine.length > marker.length * 2) {
      const content = singleLine.slice(marker.length, -marker.length);
      return `${marker}${truncatePlainText(content, availableWidth)}${marker}`;
    }
  }
  return truncatePlainText(singleLine, availableWidth);
}

function getBaseTitle(cwd: string): string {
  return `π · ${basename(cwd) || "session"}`;
}

function hideInlineWorkingRow(ui: ExtensionUIContext): void {
  ui.setWorkingVisible(false);
}

export default function codexUiExtension(pi: ExtensionAPI): void {
  let lowPowerEnabled = false;
  let currentKeybindings: KeybindingsManager | undefined;
  let titleFrameIndex = 0;
  let titleTimer: ReturnType<typeof setInterval> | undefined;

  const clearTitleTimer = (): void => {
    if (titleTimer === undefined) return;
    clearInterval(titleTimer);
    titleTimer = undefined;
  };

  const startTitleSpinner = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui") return;

    clearTitleTimer();
    titleFrameIndex = 0;
    const paintFrame = (): void => {
      const spinner = TITLE_SPINNER_FRAMES[titleFrameIndex % TITLE_SPINNER_FRAMES.length] ?? "⠋";
      const dots = TITLE_DOT_FRAMES[titleFrameIndex % TITLE_DOT_FRAMES.length] ?? "...";
      titleFrameIndex += 1;
      ctx.ui.setTitle(`${spinner} π Pi · Thinking${dots}`);
    };
    paintFrame();
    titleTimer = setInterval(paintFrame, TITLE_SPINNER_INTERVAL_MS);
  };

  const stopTitleSpinner = (ctx: ExtensionContext): void => {
    clearTitleTimer();
    titleFrameIndex = 0;
    if (ctx.mode === "tui") ctx.ui.setTitle(getBaseTitle(ctx.cwd));
  };

  registerCodexTools(pi, undefined, {
    getKeybindings: () => currentKeybindings,
    isLowPowerEnabled: () => lowPowerEnabled,
  });

  pi.registerCommand("lowpower", {
    description: "Toggle low-power rendering for write, edit, and bash",
    getArgumentCompletions(prefix) {
      const normalizedPrefix = prefix.trim().toLowerCase();
      const matches = LOW_POWER_ARGUMENTS
        .filter((argument) => argument.startsWith(normalizedPrefix))
        .map((argument) => ({ value: argument, label: argument }));
      return matches.length > 0 ? matches : null;
    },
    async handler(args, ctx) {
      const action = args.trim().toLowerCase();
      if (action && action !== "on" && action !== "off" && action !== "status") {
        ctx.ui.notify("Usage: /lowpower [on|off|status]", "error");
        return;
      }
      if (action === "status") {
        ctx.ui.notify(`Low power: ${lowPowerEnabled ? "on" : "off"}`, "info");
        return;
      }

      if (action === "on") {
        lowPowerEnabled = true;
      } else if (action === "off") {
        lowPowerEnabled = false;
      } else {
        lowPowerEnabled = !lowPowerEnabled;
      }
      hideInlineWorkingRow(ctx.ui);
      ctx.ui.setStatus("codex-ui-lowpower", lowPowerEnabled ? "Low power" : undefined);
      ctx.ui.notify(`Low power: ${lowPowerEnabled ? "on" : "off"}`, "info");
    },
  });

  let currentModelId: string | undefined;
  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
  });

  pi.on("agent_start", (_event, ctx) => {
    startTitleSpinner(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    stopTitleSpinner(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopTitleSpinner(ctx);
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType === "assistant-thinking") {
      return compactThinkingMarkdown(markdown, context.availableWidth);
    }
    if (context.messageType !== "user" || markdown.length === 0 || markdown.startsWith("› ")) {
      return markdown;
    }
    return `› ${markdown}`;
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setStatus("codex-ui-lowpower", lowPowerEnabled ? "Low power" : undefined);
    currentModelId = ctx.model?.id;
    if (ctx.ui.theme.name !== CODEX_THEME_NAME) {
      const profileTheme = ctx.ui.getTheme(CODEX_THEME_NAME);
      if (!profileTheme) {
        ctx.ui.notify(`Codex profile theme unavailable: ${CODEX_THEME_NAME}`, "warning");
      } else {
        const themeResult = ctx.ui.setTheme(profileTheme);
        if (!themeResult.success) {
          ctx.ui.notify(`Codex profile theme unavailable: ${themeResult.error ?? "unknown error"}`, "warning");
        }
      }
    }

    const getTheme = () => ctx.ui.theme;
    const getModelId = () => currentModelId;
    const getThinkingLevel = () => pi.getThinkingLevel();

    ctx.ui.setHeader(() => new CodexHeader({
      version: VERSION,
      cwd: ctx.cwd,
      home: process.env.HOME,
      getModelId,
      getThinkingLevel,
      getTheme,
    }));

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      currentKeybindings = keybindings;
      return new CodexEditor(tui, editorTheme, keybindings, getTheme);
    });

    ctx.ui.setFooter((tui, _theme, footerData) => {
      const footer = new CodexFooter({
        cwd: ctx.cwd,
        home: process.env.HOME,
        getModelId,
        getThinkingLevel,
        getContextUsage: () => ctx.getContextUsage(),
        getBranch: () => footerData.getGitBranch(),
        getExtensionStatuses: () => footerData.getExtensionStatuses(),
        getTheme,
      });
      footer.setBranchSubscription(footerData.onBranchChange(() => {
        footer.invalidate();
        tui.requestRender();
      }));
      return footer;
    });

    ctx.ui.setTitle(getBaseTitle(ctx.cwd));
    hideInlineWorkingRow(ctx.ui);
  });
}
