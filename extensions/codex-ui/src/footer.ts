import { basename } from "node:path";
import type { ContextUsage, Theme } from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

import {
  fitToWidth,
  formatHomePath,
  normalizeWidth,
} from "./layout.js";

import { renderGoalDisplay, type GoalFooterDisplay } from "./goal-display.js";

export interface CodexFooterOptions {
  getGoalDisplay?: () => GoalFooterDisplay | undefined;
  cwd: string;
  home?: string;
  getModelId: () => string | undefined;
  getThinkingLevel: () => string;
  getContextUsage: () => Pick<ContextUsage, "percent"> | undefined;
  getBranch: () => string | null;
  getExtensionStatuses: () => ReadonlyMap<string, string>;
  getTheme: () => Theme;
}

type CodexTone = "model" | "usage" | "mode";
type FooterTone = CodexTone | "muted" | "dim" | "accent" | "warning";

type FooterPart = {
  text: string;
  tone: FooterTone;
};

type FooterVariant = {
  parts: readonly FooterPart[];
};

type FooterItem = {
  key: string;
  variants: readonly FooterVariant[];
  priority: number;
  order: number;
  pinned?: boolean;
};

type FooterItemState = {
  item: FooterItem;
  variantIndex: number;
  hidden: boolean;
};

const FAST_STATUS_KEY = "pi-openai-fast-mode";
const PERMISSIONS_STATUS_KEY = "permissions";
const ITEM_SEPARATOR = " ⋅ ";
const SIDE_PADDING = 1;
const ANSI_FOREGROUND_RESET = "\x1b[39m";

// Codex CLI 0.151.0 adaptive dark palette after its status-line softening pass.
const CODEX_STATUS_RGB = {
  model: [246, 226, 183],
  usage: [242, 181, 144],
  mode: [200, 169, 238],
} as const satisfies Record<CodexTone, readonly [number, number, number]>;

export class CodexFooter implements Component {
  private readonly statusCache = new Map<string, { raw: string; sanitized: string }>();
  private unsubscribeBranch: (() => void) | undefined;
  private cachedSnapshot: {
    width: number;
    theme: Theme;
    modelId: string;
    thinking: string;
    branch: string | null;
    contextPercent: number | null | undefined;
    fast: string | undefined;
    permissions: string | undefined;
    lines: string[];
  } | undefined;

  private combined: { base: string[]; key: string; theme: Theme; lines: string[] } | undefined;

  constructor(private readonly options: CodexFooterOptions) {}

  setBranchSubscription(unsubscribe: () => void): void {
    this.unsubscribeBranch?.();
    this.unsubscribeBranch = unsubscribe;
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    const statuses = this.options.getExtensionStatuses();
    const base = this.renderBase(safeWidth, statuses);
    const theme = this.options.getTheme();
    const goal = this.readStatus(statuses, "goal");
    const display = goal ? this.options.getGoalDisplay?.() : undefined;
    const key = JSON.stringify([safeWidth, display ?? goal]);
    if (this.combined?.base === base && this.combined.key === key && this.combined.theme === theme) return this.combined.lines;
    const lines = [...base];
    if (display) lines.push(...renderGoalDisplay(display, safeWidth, theme));
    else if (goal) lines.push(fitToWidth(theme.fg("muted", ` ${goal}`), safeWidth));
    this.combined = { base, key, theme, lines };
    return lines;
  }

  private renderBase(width: number, statuses: ReadonlyMap<string, string>): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];

    const theme = this.options.getTheme();
    const modelId = this.options.getModelId() ?? "No model";
    const thinking = this.options.getThinkingLevel();
    const branch = this.options.getBranch();
    const contextPercent = this.options.getContextUsage()?.percent;
    const fastStatus = this.readStatus(statuses, FAST_STATUS_KEY);
    const fast = fastStatus?.toLowerCase() === "fast" ? "fast" : undefined;
    const permissions = this.readStatus(statuses, PERMISSIONS_STATUS_KEY);

    const cached = this.cachedSnapshot;
    if (
      cached?.width === safeWidth
      && cached.theme === theme
      && cached.modelId === modelId
      && cached.thinking === thinking
      && cached.branch === branch
      && cached.contextPercent === contextPercent
      && cached.fast === fast
      && cached.permissions === permissions
    ) {
      return cached.lines;
    }

    const input: FooterRenderInput = {
      width: safeWidth,
      modelId,
      thinking,
      cwd: this.options.cwd,
      home: this.options.home,
      branch,
      contextPercent,
      fast,
      permissions,
      theme,
    };
    const lines = [renderFooter(input)];
    this.cachedSnapshot = {
      width: safeWidth,
      theme,
      modelId,
      thinking,
      branch,
      contextPercent,
      fast,
      permissions,
      lines,
    };
    return lines;
  }

  invalidate(): void {
    this.combined = undefined;
    this.cachedSnapshot = undefined;
  }

  dispose(): void {
    this.unsubscribeBranch?.();
    this.unsubscribeBranch = undefined;
  }

  private readStatus(statuses: ReadonlyMap<string, string>, key: string): string | undefined {
    const raw = statuses.get(key);
    if (raw === undefined) {
      this.statusCache.delete(key);
      return undefined;
    }

    const cached = this.statusCache.get(key);
    if (cached?.raw === raw) return cached.sanitized || undefined;

    const sanitized = sanitizeStatus(raw);
    this.statusCache.set(key, { raw, sanitized });
    return sanitized || undefined;
  }
}

type FooterRenderInput = {
  width: number;
  modelId: string;
  thinking: string;
  cwd: string;
  home?: string;
  branch: string | null;
  contextPercent: number | null | undefined;
  fast: string | undefined;
  permissions: string | undefined;
  theme: Theme;
};

function renderFooter(input: FooterRenderInput): string {
  const horizontalPadding = input.width > SIDE_PADDING * 2 ? SIDE_PADDING * 2 : 0;
  const contentWidth = Math.max(0, input.width - horizontalPadding);
  const states = buildItems(input).map((item) => ({
    item,
    variantIndex: 0,
    hidden: false,
  }));

  fitItems(states, contentWidth);

  const content = visibleStates(states)
    .map((state) => {
      const current = state.item.variants[state.variantIndex];
      return current ? renderVariant(current, input.theme) : "";
    })
    .filter(Boolean)
    .join(input.theme.fg("dim", ITEM_SEPARATOR));
  const padding = horizontalPadding === 0 ? "" : " ";
  return fitToWidth(`${padding}${content}${padding}`, input.width);
}

function buildItems(input: FooterRenderInput): FooterItem[] {
  const items: FooterItem[] = [createModelItem(input.modelId, input.thinking)];
  if (input.fast) items.push(createFastItem(input.fast));
  items.push(createLocationItem(input.cwd, input.home, input.branch));

  const context = createContextItem(input.contextPercent);
  if (context) items.push(context);
  if (input.permissions) items.push(createPermissionsItem(input.permissions));
  return items;
}

function createModelItem(modelId: string, thinking: string): FooterItem {
  return {
    key: "model",
    priority: 100,
    order: 0,
    pinned: true,
    variants: uniqueVariants([
      variant(part(`${modelId} ${thinking}`, "model")),
      variant(part(modelId, "model")),
      variant(part(truncateToWidth(modelId, 24, "…"), "model")),
    ]),
  };
}

function createFastItem(text: string): FooterItem {
  return {
    key: "fast",
    priority: 90,
    order: 50,
    variants: [variant(part(text, "mode"))],
  };
}

function createLocationItem(cwd: string, home: string | undefined, branch: string | null): FooterItem {
  const path = formatHomePath(cwd, home);
  const project = basename(cwd) || path;
  if (!branch) {
    return {
      key: "location",
      priority: 60,
      order: 100,
      variants: uniqueVariants([
        variant(part(path, "muted")),
        variant(part(project, "muted")),
      ]),
    };
  }

  return {
    key: "location",
    priority: 60,
    order: 100,
    variants: uniqueVariants([
      variant(
        part(path, "muted"),
        part(ITEM_SEPARATOR, "dim"),
        part(`git:${branch}`, "accent"),
      ),
      variant(
        part(project, "muted"),
        part(ITEM_SEPARATOR, "dim"),
        part(branch, "accent"),
      ),
      variant(part(`git:${branch}`, "accent")),
      variant(part(truncateToWidth(branch, 22, "…"), "accent")),
    ]),
  };
}

function createContextItem(percent: number | null | undefined): FooterItem | undefined {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return undefined;

  const left = Math.round(100 - Math.max(0, Math.min(100, percent)));
  return {
    key: "context",
    priority: 85,
    order: 200,
    pinned: true,
    variants: uniqueVariants([
      variant(part(`Context ${left}% left`, "usage")),
      variant(part(`${left}% left`, "usage")),
      variant(part(`${left}%`, "usage")),
    ]),
  };
}

function createPermissionsItem(text: string): FooterItem {
  return {
    key: "permissions",
    priority: 110,
    order: 300,
    pinned: true,
    variants: [variant(part(text, /full access/iu.test(text) ? "warning" : "muted"))],
  };
}

function fitItems(states: FooterItemState[], width: number): void {
  while (measureStates(states) > width) {
    const downgrade = states
      .filter((state) => !state.hidden && state.variantIndex + 1 < state.item.variants.length)
      .map((state) => ({ state, ...nextShorterVariant(state) }))
      .filter(({ saving }) => saving > 0)
      .sort((left, right) => (
        left.state.item.priority - right.state.item.priority
        || right.saving - left.saving
        || right.state.item.order - left.state.item.order
      ))[0];
    const removable = states
      .filter((state) => !state.hidden && !state.item.pinned)
      .sort((left, right) => (
        left.item.priority - right.item.priority
        || right.item.order - left.item.order
      ))[0];

    if (downgrade && (!removable || downgrade.state.item.priority <= removable.item.priority)) {
      downgrade.state.variantIndex = downgrade.index;
      continue;
    }
    if (!removable) break;
    removable.hidden = true;
  }
}

function measureStates(states: readonly FooterItemState[]): number {
  const visible = visibleStates(states);
  return visible.reduce((total, state) => total + currentVariantWidth(state), 0)
    + visibleWidth(ITEM_SEPARATOR) * Math.max(0, visible.length - 1);
}

function visibleStates(states: readonly FooterItemState[]): FooterItemState[] {
  return states
    .filter((state) => !state.hidden)
    .sort((left, right) => left.item.order - right.item.order || left.item.key.localeCompare(right.item.key));
}

function nextShorterVariant(state: FooterItemState): { index: number; saving: number } {
  const width = currentVariantWidth(state);
  for (let index = state.variantIndex + 1; index < state.item.variants.length; index++) {
    const saving = width - variantWidth(state.item.variants[index]!);
    if (saving > 0) return { index, saving };
  }
  return { index: state.variantIndex, saving: 0 };
}

function currentVariantWidth(state: FooterItemState): number {
  const current = state.item.variants[state.variantIndex];
  return current ? variantWidth(current) : 0;
}

function variantWidth(value: FooterVariant): number {
  return value.parts.reduce((total, item) => total + visibleWidth(item.text), 0);
}

function renderVariant(value: FooterVariant, theme: Theme): string {
  return value.parts.map((item) => (
    isCodexTone(item.tone)
      ? paintCodexTone(item.tone, item.text, theme)
      : theme.fg(item.tone, item.text)
  )).join("");
}

function paintCodexTone(tone: CodexTone, text: string, theme: Theme): string {
  if (theme.getColorMode() !== "truecolor") {
    const fallback: Record<CodexTone, "syntaxType" | "syntaxNumber" | "syntaxKeyword"> = {
      model: "syntaxType",
      usage: "syntaxNumber",
      mode: "syntaxKeyword",
    };
    return theme.fg(fallback[tone], text);
  }

  const [red, green, blue] = CODEX_STATUS_RGB[tone];
  return `\x1b[38;2;${red};${green};${blue}m${text}${ANSI_FOREGROUND_RESET}`;
}

function isCodexTone(tone: FooterTone): tone is CodexTone {
  return tone === "model" || tone === "usage" || tone === "mode";
}

function sanitizeStatus(raw: string): string {
  return stripTerminalSequences(raw)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:[.·⋅∙│|]\s*)+/u, "");
}

function uniqueVariants(values: readonly FooterVariant[]): FooterVariant[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.parts.map((item) => item.text).join("");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function variant(...parts: FooterPart[]): FooterVariant {
  return { parts };
}

function part(text: string, tone: FooterTone): FooterPart {
  return { text, tone };
}
