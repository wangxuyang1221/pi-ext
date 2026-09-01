import { isAbsolute, relative, sep } from "node:path";
import { createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition, DEFAULT_MAX_BYTES, formatSize, getLanguageFromPath, highlightCode, keyHint, } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi, } from "@earendil-works/pi-tui";
import { BashRefreshScheduler } from "./bash-refresh-scheduler.js";
import { getExactFittedVisualLines, getExactVisualTail, } from "./exact-visual-tail.js";
import { fitToWidth, formatHomePath, normalizeWidth, paintBackground, } from "./layout.js";
import { ResponsiveLinesComponent } from "./responsive-lines.js";
const COLLAPSED_BASH_LINES = 5;
const COLLAPSED_DIFF_LINES = 12;
const EXPANDED_READ_LINES = 40;
const BASH_DURATION_REFRESH_MS = 1000;
const DIFF_INDENT = "    ";
const ANSI_DEFAULT_FOREGROUND = "\x1b[39m";
const ANSI_DIM = "\x1b[2m";
const ANSI_INTENSITY_RESET = "\x1b[22m";
const ANSI_NAMED_GREEN = "\x1b[32m";
const ANSI_NAMED_RED = "\x1b[31m";
const ANSI_FOREGROUND_RESET = /\x1b\[39m/gu;
const ANSI_FULL_SGR_RESET = /\x1b\[(?:0)?m/gu;
const BASH_STATUS_PRESENTATION = {
    pending: { glyph: "•", color: "dim" },
    running: { glyph: "…", color: "warning" },
    completed: { glyph: "✓", color: "success" },
    failed: { glyph: "✗", color: "error" },
};
const DEFAULT_FACTORIES = {
    read: createReadToolDefinition,
    edit: createEditToolDefinition,
    write: createWriteToolDefinition,
    bash: createBashToolDefinition,
};
export function registerCodexTools(pi, factories = DEFAULT_FACTORIES, services = {}) {
    const getReadDefinition = createDefinitionCache(factories.read);
    const getEditDefinition = createDefinitionCache(factories.edit);
    const getWriteDefinition = createDefinitionCache(factories.write);
    const getBashDefinition = createDefinitionCache(factories.bash);
    const bashRefreshScheduler = new BashRefreshScheduler(BASH_DURATION_REFRESH_MS);
    pi.on("tool_execution_end", (event) => {
        if (event.toolName === "bash") {
            bashRefreshScheduler.untrack(event.toolCallId);
        }
    });
    pi.on("session_shutdown", () => {
        bashRefreshScheduler.dispose();
    });
    const baseRead = getReadDefinition(process.cwd());
    const readTool = {
        ...baseRead,
        renderShell: "self",
        execute(toolCallId, params, signal, onUpdate, ctx) {
            return getReadDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
            const state = context.state;
            const path = formatToolPath(args.path, context.cwd);
            const range = formatReadRange(args.offset, args.limit, theme);
            if (state.path !== path) {
                state.path = path;
                state.settledTitle = undefined;
            }
            state.initialTitle = formatToolTitle("Read", path, theme, range);
            const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
            state.callComponent = component;
            component.setRenderer((width) => [
                fitToWidth(state.settledTitle ?? state.initialTitle ?? "", width),
            ], { linesAlreadyFit: true });
            return component;
        },
        renderResult(result, options, theme, context) {
            const state = context.state;
            const path = formatToolPath(context.args.path, context.cwd);
            const range = formatReadRange(context.args.offset, context.args.limit, theme);
            const nextTitle = !options.isPartial && !context.isError
                ? formatToolTitle("Read", path, theme, range, { glyph: "✓", color: "success" })
                : undefined;
            if (state.settledTitle !== nextTitle) {
                state.settledTitle = nextTitle;
                state.callComponent?.invalidate();
            }
            return updateComponent(context.lastComponent, (width) => renderReadResult(result, options, theme, context.isError, width));
        },
    };
    pi.registerTool(readTool);
    const baseEdit = getEditDefinition(process.cwd());
    const editTool = {
        ...baseEdit,
        renderShell: "self",
        execute(toolCallId, params, signal, onUpdate, ctx) {
            return getEditDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
            const state = context.state;
            const path = formatToolPath(args.path, context.cwd);
            if (state.path !== path) {
                state.path = path;
                state.settledTitle = undefined;
            }
            state.initialTitle = formatEditTitle("Edit", path, theme);
            const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
            state.callComponent = component;
            component.setRenderer((width) => [
                fitToWidth(state.settledTitle ?? state.initialTitle ?? "", width),
            ], { linesAlreadyFit: true });
            return component;
        },
        renderResult(result, options, theme, context) {
            const state = context.state;
            const path = state.path ?? formatToolPath(context.args.path, context.cwd);
            const details = result.details;
            const preparedDiff = !options.isPartial
                && !context.isError
                && details
                && (details.patch || details.diff)
                ? getPreparedEditDiff(state, details, path, theme)
                : undefined;
            let nextTitle;
            if (options.isPartial) {
                nextTitle = formatEditTitle("Editing", path, theme, `${ANSI_DIM}…${ANSI_INTENSITY_RESET}`);
            }
            else if (context.isError) {
                nextTitle = formatEditTitle("Edit failed", path, theme);
            }
            else if (preparedDiff) {
                const stats = state.preparedStats ?? countDiffStats(preparedDiff);
                state.preparedStats = stats;
                const suffix = `(${namedGreen(`+${stats.added}`)} ${namedRed(`-${stats.removed}`)})`;
                nextTitle = formatEditTitle("Edited", path, theme, suffix);
            }
            else {
                nextTitle = formatEditTitle("Edited", path, theme);
            }
            if (state.settledTitle !== nextTitle) {
                state.settledTitle = nextTitle;
                state.callComponent?.invalidate();
            }
            return updateComponent(context.lastComponent, (width) => getEditResultLayout(state, result, preparedDiff, options, path, theme, context.isError, width));
        },
    };
    pi.registerTool(editTool);
    const baseWrite = getWriteDefinition(process.cwd());
    const writeTool = {
        ...baseWrite,
        renderShell: "self",
        execute(toolCallId, params, signal, onUpdate, ctx) {
            return getWriteDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
            const state = context.state;
            const path = formatToolPath(args.path, context.cwd);
            const metrics = getWriteMetrics(state, args.content, context.argsComplete);
            const suffix = theme.fg("dim", `(${formatLineCount(metrics.lineCount)})`);
            return updateComponent(context.lastComponent, (width) => [
                fitToWidth(formatToolTitle("Write", path, theme, suffix), width),
            ]);
        },
        renderResult(result, options, theme, context) {
            const state = context.state;
            const metrics = getWriteMetrics(state, context.args.content, context.argsComplete || (!options.isPartial && !context.isError));
            return updateComponent(context.lastComponent, (width) => renderWriteResult(result, metrics, options.isPartial, theme, context.isError, width));
        },
    };
    pi.registerTool(writeTool);
    const baseBash = getBashDefinition(process.cwd());
    const bashTool = {
        ...baseBash,
        execute(toolCallId, params, signal, onUpdate, ctx) {
            return getBashDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
            const state = context.state;
            updateBashLifecycle(state, context, bashRefreshScheduler);
            const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
            state.callComponent = component;
            component.setRenderer((width) => renderBashCall(args, state, theme, width), { linesAlreadyFit: true });
            return component;
        },
        renderResult(result, options, theme, context) {
            const state = context.state;
            const prepared = getPreparedBashResult(state, result, options.isPartial);
            return updateComponent(context.lastComponent, (width) => getBashResultLayout(state, prepared, options, theme, services, width));
        },
    };
    pi.registerTool(bashTool);
}
export function parseDisplayDiff(diff) {
    const rawLines = diff.split("\n");
    if (rawLines.at(-1) === "")
        rawLines.pop();
    return rawLines.map((line) => {
        const marker = line[0];
        const kind = marker === "+"
            ? "added"
            : marker === "-"
                ? "removed"
                : "context";
        const body = marker === "+" || marker === "-" || marker === " "
            ? line.slice(1)
            : line;
        const match = body.match(/^\s*(\d+)(?:\s(.*))?$/u);
        if (!match && kind === "context" && body.trim() === "...") {
            return { kind: "hunk", lineNumber: undefined, text: "⋮" };
        }
        return {
            kind,
            lineNumber: match ? Number.parseInt(match[1] ?? "", 10) : undefined,
            text: match ? (match[2] ?? "") : body.trimStart(),
        };
    });
}
export function parseUnifiedPatch(patch) {
    const parsed = [];
    let oldLine = 0;
    let newLine = 0;
    let hunkCount = 0;
    let inHunk = false;
    for (const line of patch.split("\n")) {
        const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
        if (hunk) {
            if (hunkCount > 0) {
                parsed.push({ kind: "hunk", lineNumber: undefined, text: "⋮" });
            }
            oldLine = Number.parseInt(hunk[1] ?? "0", 10);
            newLine = Number.parseInt(hunk[2] ?? "0", 10);
            hunkCount += 1;
            inHunk = true;
            continue;
        }
        if (!inHunk || line.startsWith("\\ No newline at end of file"))
            continue;
        const marker = line[0];
        const text = line.slice(1);
        if (marker === "-") {
            parsed.push({ kind: "removed", lineNumber: oldLine, text });
            oldLine += 1;
        }
        else if (marker === "+") {
            parsed.push({ kind: "added", lineNumber: newLine, text });
            newLine += 1;
        }
        else if (marker === " ") {
            parsed.push({ kind: "context", lineNumber: newLine, text });
            oldLine += 1;
            newLine += 1;
        }
    }
    return parsed;
}
export function renderDisplayDiff(lines, theme, width, path = "") {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return [];
    const lineNumberWidth = getDisplayLineNumberWidth(lines);
    const language = getLanguageFromPath(path);
    const codeForeground = theme.getFgAnsi("toolDiffContext");
    return lines.map((line) => {
        if (line.kind === "hunk") {
            return fitToWidth(`${DIFF_INDENT}${ANSI_DIM}⋮${ANSI_INTENSITY_RESET}`, safeWidth);
        }
        const lineNumber = line.lineNumber === undefined
            ? " ".repeat(lineNumberWidth)
            : String(line.lineNumber).padStart(lineNumberWidth);
        const gutter = `${ANSI_DIM}${ANSI_DEFAULT_FOREGROUND}${lineNumber}${ANSI_INTENSITY_RESET}`;
        const sign = line.kind === "added"
            ? namedGreen("+")
            : line.kind === "removed"
                ? namedRed("-")
                : " ";
        const highlighted = line.highlightedText ?? (language
            ? (highlightCode(line.text, language)[0] ?? line.text)
            : line.text);
        const codeWithDefault = applyCodeForeground(highlighted, codeForeground);
        const code = line.kind === "removed"
            ? `${ANSI_DIM}${codeWithDefault}${ANSI_INTENSITY_RESET}`
            : codeWithDefault;
        const content = `${DIFF_INDENT}${gutter} ${sign} ${code}`;
        if (line.kind === "added") {
            return paintBackground(content, safeWidth, theme.getBgAnsi("toolSuccessBg"));
        }
        if (line.kind === "removed") {
            return paintBackground(content, safeWidth, theme.getBgAnsi("toolErrorBg"), ANSI_DIM);
        }
        return fitToWidth(content, safeWidth);
    });
}
export function getDisplayLineNumberWidth(lines) {
    let lineNumberWidth = 1;
    for (const line of lines) {
        if (line.lineNumber === undefined)
            continue;
        lineNumberWidth = Math.max(lineNumberWidth, String(line.lineNumber).length);
    }
    return lineNumberWidth;
}
function createDefinitionCache(factory) {
    const definitions = new Map();
    return (cwd) => {
        const cached = definitions.get(cwd);
        if (cached)
            return cached;
        const definition = factory(cwd);
        definitions.set(cwd, definition);
        return definition;
    };
}
function getResponsiveComponent(previous) {
    return previous instanceof ResponsiveLinesComponent
        ? previous
        : new ResponsiveLinesComponent();
}
function updateComponent(previous, renderer) {
    const component = getResponsiveComponent(previous);
    component.setRenderer(renderer, { linesAlreadyFit: true });
    return component;
}
function formatEditTitle(action, path, theme, suffix = "") {
    const parts = [
        `${ANSI_DIM}•${ANSI_INTENSITY_RESET}`,
        theme.bold(action),
        path || "(unknown path)",
    ];
    if (suffix)
        parts.push(suffix);
    return parts.join(" ");
}
function formatToolTitle(action, path, theme, suffix = "", marker = { glyph: "•", color: "dim" }) {
    const parts = [
        theme.fg(marker.color, marker.glyph),
        theme.fg("toolTitle", theme.bold(action)),
        theme.fg("accent", path || "(unknown path)"),
    ];
    if (suffix)
        parts.push(suffix);
    return parts.join(" ");
}
function formatToolPath(path, cwd) {
    if (!path)
        return "";
    if (!isAbsolute(path))
        return path;
    const relativePath = relative(cwd, path);
    if (relativePath.length > 0
        && relativePath !== ".."
        && !relativePath.startsWith(`..${sep}`)
        && !isAbsolute(relativePath)) {
        return relativePath;
    }
    if (relativePath === "")
        return ".";
    return formatHomePath(path);
}
function formatReadRange(offset, limit, theme) {
    if (offset === undefined && limit === undefined)
        return "";
    const parts = [];
    if (offset !== undefined)
        parts.push(`offset=${offset}`);
    if (limit !== undefined)
        parts.push(`limit=${limit}`);
    return theme.fg("dim", `(${parts.join(", ")})`);
}
function renderReadResult(result, options, theme, isError, width) {
    if (options.isPartial) {
        return [fitToWidth(theme.fg("warning", "  … Reading"), width)];
    }
    const text = extractText(result.content);
    if (isError) {
        return [fitToWidth(theme.fg("error", `  ✗ ${firstLine(text) || "Read failed"}`), width)];
    }
    const hasImage = result.content.some((content) => content.type === "image");
    const lineCount = countLines(text);
    let summary = hasImage
        ? `  ${theme.fg("toolOutput", "Image loaded")}`
        : `  ${theme.fg("toolOutput", theme.bold(String(lineCount)))} ${theme.fg("dim", lineCount === 1 ? "line" : "lines")}`;
    if (result.details?.truncation?.truncated) {
        summary += theme.fg("dim", " · truncated");
    }
    const lines = [summary];
    if (options.expanded && text) {
        const contentLines = text.split("\n");
        const shown = contentLines.slice(0, EXPANDED_READ_LINES);
        lines.push(...shown.map((line) => `    ${theme.fg("toolOutput", line)}`));
        const remaining = contentLines.length - shown.length;
        if (remaining > 0) {
            lines.push(theme.fg("dim", `    … ${remaining} more lines`));
        }
    }
    return lines.map((line) => fitToWidth(line, width));
}
function getEditResultThemeFingerprint(theme) {
    return [
        theme.fg("warning", "x"),
        theme.fg("error", "x"),
        theme.fg("success", "x"),
        theme.getFgAnsi("toolDiffContext"),
        theme.getBgAnsi("toolSuccessBg"),
        theme.getBgAnsi("toolErrorBg"),
    ].join("\0");
}
function getEditResultLayout(state, result, diffLines, options, path, theme, isError, width) {
    const source = diffLines ?? result.content;
    const themeFingerprint = getEditResultThemeFingerprint(theme);
    if (state.layoutSource !== source) {
        state.layoutSource = source;
        state.collapsedLayouts = [];
        state.expandedLayout = undefined;
    }
    if (options.expanded) {
        const cached = state.expandedLayout;
        if (cached?.source === source
            && cached.width === width
            && cached.isPartial === options.isPartial
            && cached.isError === isError
            && cached.path === path
            && cached.theme === theme
            && cached.themeFingerprint === themeFingerprint) {
            return cached.lines;
        }
        const lines = renderEditResult(result, diffLines, options, path, theme, isError, width);
        state.expandedLayout = {
            source,
            width,
            isPartial: options.isPartial,
            isError,
            path,
            theme,
            themeFingerprint,
            lines,
        };
        return lines;
    }
    if (state.expandedLayout && diffLines) {
        for (let index = COLLAPSED_DIFF_LINES; index < diffLines.length; index += 1) {
            diffLines[index].highlightedText = undefined;
        }
    }
    state.expandedLayout = undefined;
    const layouts = state.collapsedLayouts ??= [];
    const cachedIndex = layouts.findIndex((entry) => (entry.source === source
        && entry.width === width
        && entry.isPartial === options.isPartial
        && entry.isError === isError
        && entry.path === path
        && entry.theme === theme
        && entry.themeFingerprint === themeFingerprint));
    const cached = layouts[cachedIndex];
    if (cached) {
        if (cachedIndex !== layouts.length - 1) {
            layouts.splice(cachedIndex, 1);
            layouts.push(cached);
        }
        return cached.lines;
    }
    const lines = renderEditResult(result, diffLines, options, path, theme, isError, width);
    layouts.push({
        source,
        width,
        isPartial: options.isPartial,
        isError,
        path,
        theme,
        themeFingerprint,
        lines,
    });
    if (layouts.length > 2)
        layouts.shift();
    return lines;
}
function renderEditResult(result, diffLines, options, path, theme, isError, width) {
    if (options.isPartial) {
        return [fitToWidth(theme.fg("warning", "  … Editing"), width)];
    }
    if (isError) {
        const error = firstLine(extractText(result.content)) || "Edit failed";
        return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
    }
    if (!diffLines) {
        return [fitToWidth(theme.fg("success", "  └ Applied"), width)];
    }
    const maximum = options.expanded ? diffLines.length : COLLAPSED_DIFF_LINES;
    const visible = diffLines.slice(0, maximum);
    prepareDiffHighlights(visible, path);
    const lines = renderDisplayDiff(visible, theme, width, path);
    const remaining = diffLines.length - visible.length;
    if (remaining > 0) {
        lines.push("", renderDiffTruncationFooter(remaining, width));
    }
    return lines;
}
function renderDiffTruncationFooter(remaining, width) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return "";
    const label = `${DIFF_INDENT}── ${remaining} ${remaining === 1 ? "line" : "lines"} hidden `;
    const rule = "─".repeat(Math.max(0, safeWidth - visibleWidth(label)));
    return fitToWidth(`${ANSI_DIM}${label}${rule}${ANSI_INTENSITY_RESET}`, safeWidth);
}
function renderWriteResult(result, metrics, isPartial, theme, isError, width) {
    if (isPartial) {
        return [fitToWidth(theme.fg("warning", "  … Writing"), width)];
    }
    if (isError) {
        const error = firstLine(extractText(result.content)) || "Write failed";
        return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
    }
    const summary = `  └ Written · ${formatLineCount(metrics.lineCount)} · ${formatBytes(metrics.bytes ?? Buffer.byteLength(metrics.content, "utf8"))}`;
    return [fitToWidth(theme.fg("success", summary), width)];
}
function updateBashLifecycle(state, context, scheduler) {
    const nextStatus = context.isError
        ? "failed"
        : !context.isPartial
            ? "completed"
            : context.executionStarted
                ? "running"
                : "pending";
    if (nextStatus === "running") {
        if (state.startedAt === undefined) {
            state.startedAt = Date.now();
            state.endedAt = undefined;
        }
        if (state.status !== "running") {
            scheduler.track(context.toolCallId, context.invalidate);
        }
    }
    else {
        if ((nextStatus === "completed" || nextStatus === "failed")
            && state.startedAt !== undefined
            && state.endedAt === undefined) {
            state.endedAt = Date.now();
        }
        scheduler.untrack(context.toolCallId);
    }
    state.status = nextStatus;
}
function renderBashCall(args, state, theme, width) {
    const status = state.status ?? "pending";
    const presentation = BASH_STATUS_PRESENTATION[status];
    const summary = [
        theme.fg(presentation.color, presentation.glyph),
        theme.fg("toolTitle", theme.bold("Bash")),
        theme.fg("muted", status),
    ].join(" ");
    const metadata = [];
    if (state.startedAt !== undefined) {
        const endTime = state.endedAt ?? Date.now();
        metadata.push(formatDuration(Math.max(0, endTime - state.startedAt)));
    }
    if (typeof args.timeout === "number" && Number.isFinite(args.timeout) && args.timeout > 0) {
        metadata.push(`${args.timeout}s limit`);
    }
    const lines = renderAlignedLines(summary, metadata.length > 0 ? theme.fg("dim", metadata.join(" · ")) : "", width);
    lines.push("", ...renderBashCommand(args.command, state, status, theme, width));
    return lines;
}
function renderBashCommand(command, state, status, theme, width) {
    const source = typeof command === "string" ? command : "";
    const themeFingerprint = getBashCommandThemeFingerprint(theme);
    if (state.commandSource !== source
        || state.commandTheme !== theme
        || state.commandThemeFingerprint !== themeFingerprint) {
        state.commandSource = source;
        state.commandTheme = theme;
        state.commandThemeFingerprint = themeFingerprint;
        state.commandGeometry = [];
        state.commandPaint = undefined;
    }
    const geometries = state.commandGeometry ??= [];
    let geometryIndex = geometries.findIndex((entry) => entry.width === width);
    let geometry = geometries[geometryIndex];
    if (!geometry) {
        const displayCommand = sanitizeBashDisplayText(stripTerminalSequences(source)) || "…";
        const text = theme.fg("toolTitle", theme.bold(`$ ${displayCommand}`));
        const rail = width >= 2 ? theme.fg("success", "▌") : "";
        const gap = width >= 3 ? " " : "";
        const trailingPadding = width >= 4 ? 1 : 0;
        const prefix = `${rail}${gap}`;
        const contentWidth = Math.max(1, width - visibleWidth(prefix) - trailingPadding);
        const commandLines = wrapTextWithAnsi(text, contentWidth);
        geometry = {
            width,
            lines: (commandLines.length > 0 ? commandLines : [""]).map((line) => (`${theme.getBgAnsi("toolPendingBg")}${fitToWidth(`${prefix}${line}`, width, { pad: true })}`)),
        };
        geometries.push(geometry);
        if (geometries.length > 2)
            geometries.shift();
    }
    else if (geometryIndex !== geometries.length - 1) {
        geometries.splice(geometryIndex, 1);
        geometries.push(geometry);
    }
    if (state.commandPaint?.geometry === geometry && state.commandPaint.status === status) {
        return state.commandPaint.lines;
    }
    const shellBackground = status === "completed"
        ? "toolSuccessBg"
        : status === "failed"
            ? "toolErrorBg"
            : "toolPendingBg";
    const background = theme.getBgAnsi(shellBackground);
    const lines = geometry.lines.map((line) => `${line}${background}`);
    state.commandPaint = { geometry, status, lines };
    return lines;
}
function getBashCommandThemeFingerprint(theme) {
    return [
        theme.fg("toolTitle", theme.bold("x")),
        theme.fg("success", "x"),
        theme.getBgAnsi("toolPendingBg"),
        theme.getBgAnsi("toolSuccessBg"),
        theme.getBgAnsi("toolErrorBg"),
    ].join("\0");
}
function getPreparedBashResult(state, result, isPartial) {
    if (state.preparedResult !== undefined
        && state.preparedContent === result.content
        && state.preparedDetails === result.details
        && state.preparedIsPartial === isPartial) {
        return state.preparedResult;
    }
    const prepared = prepareBashResult(result, isPartial);
    state.preparedContent = result.content;
    state.preparedDetails = result.details;
    state.preparedIsPartial = isPartial;
    state.preparedResult = prepared;
    state.collapsedResultLayouts = [];
    state.expandedResultLayout = undefined;
    return prepared;
}
function prepareBashResult(result, isPartial) {
    const extracted = extractBashOutput(result.content).trim();
    const output = removeBashExecutionFooter(extracted, result.details, isPartial);
    return {
        outputLines: output ? output.split("\n") : [],
        warning: formatBashTruncationWarning(result.details),
    };
}
function getBashResultThemeFingerprint(theme) {
    return [
        theme.fg("toolOutput", "x"),
        theme.fg("warning", "x"),
        theme.fg("dim", "x"),
        theme.fg("muted", "x"),
    ].join("\0");
}
function getBashResultLayout(state, prepared, options, theme, services, width) {
    const expandHint = formatExpandHint(options.expanded ? "collapse" : "expand", theme, services);
    const themeFingerprint = getBashResultThemeFingerprint(theme);
    if (options.expanded) {
        const cached = state.expandedResultLayout;
        if (cached?.prepared === prepared
            && cached.width === width
            && cached.theme === theme
            && cached.themeFingerprint === themeFingerprint
            && cached.expandHint === expandHint) {
            return cached.lines;
        }
        const lines = layoutBashResult(prepared, true, theme, expandHint, width);
        state.expandedResultLayout = {
            prepared,
            width,
            theme,
            themeFingerprint,
            expandHint,
            lines,
        };
        return lines;
    }
    state.expandedResultLayout = undefined;
    const layouts = state.collapsedResultLayouts ??= [];
    const cachedIndex = layouts.findIndex((entry) => (entry.prepared === prepared
        && entry.width === width
        && entry.theme === theme
        && entry.themeFingerprint === themeFingerprint
        && entry.expandHint === expandHint));
    const cached = layouts[cachedIndex];
    if (cached) {
        if (cachedIndex !== layouts.length - 1) {
            layouts.splice(cachedIndex, 1);
            layouts.push(cached);
        }
        return cached.lines;
    }
    const lines = layoutBashResult(prepared, false, theme, expandHint, width);
    layouts.push({ prepared, width, theme, themeFingerprint, expandHint, lines });
    if (layouts.length > 2)
        layouts.shift();
    return lines;
}
function layoutBashResult(prepared, expanded, theme, expandHint, width) {
    let visualLines = [];
    let skippedCount = 0;
    if (prepared.outputLines.length > 0) {
        if (expanded) {
            visualLines = getExactFittedVisualLines(prepared.outputLines, (line) => theme.fg("toolOutput", line), width);
        }
        else {
            const preview = getExactVisualTail(prepared.outputLines, (line) => theme.fg("toolOutput", line), width, COLLAPSED_BASH_LINES);
            visualLines = preview.visualLines;
            skippedCount = preview.skippedCount;
        }
    }
    const lines = [""];
    for (const visualLine of visualLines) {
        lines.push(expanded ? visualLine : fitToWidth(visualLine, width));
    }
    if (prepared.warning) {
        lines.push("");
        for (const warningLine of wrapTextWithAnsi(theme.fg("warning", `[${prepared.warning}]`), width)) {
            lines.push(fitToWidth(warningLine, width));
        }
    }
    const totalVisualLines = visualLines.length + skippedCount;
    const lineLabel = `${totalVisualLines} visual ${totalVisualLines === 1 ? "line" : "lines"}`;
    const footerLabel = !expanded && skippedCount > 0
        ? `${skippedCount} earlier visual lines hidden`
        : lineLabel;
    lines.push("");
    for (const footerLine of renderAlignedLines(theme.fg("dim", footerLabel), expandHint, width)) {
        lines.push(fitToWidth(footerLine, width));
    }
    return lines;
}
function formatExpandHint(description, theme, services) {
    const keys = services.getKeybindings?.()?.getKeys("app.tools.expand") ?? [];
    if (keys.length === 0) {
        return keyHint("app.tools.expand", description);
    }
    const keyText = keys
        .map((key) => String(key)
        .split("+")
        .map((part) => process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part)
        .join("+"))
        .join("/");
    return theme.fg("dim", keyText) + theme.fg("muted", ` ${description}`);
}
function renderAlignedLines(left, right, width) {
    if (!right)
        return wrapTextWithAnsi(left, width);
    const gap = width - visibleWidth(left) - visibleWidth(right);
    if (gap >= 1) {
        return [`${left}${" ".repeat(gap)}${right}`];
    }
    const rightLines = wrapTextWithAnsi(right, width);
    return [
        ...wrapTextWithAnsi(left, width),
        ...rightLines.map((line) => `${" ".repeat(Math.max(0, width - visibleWidth(line)))}${line}`),
    ];
}
function extractBashOutput(content) {
    let output = "";
    let hasText = false;
    for (const item of content) {
        if (item.type !== "text" || typeof item.text !== "string")
            continue;
        if (hasText)
            output += "\n";
        output += sanitizeBashDisplayText(stripTerminalSequences(item.text)).replace(/\r/gu, "");
        hasText = true;
    }
    return output;
}
function sanitizeBashDisplayText(text) {
    let sanitized = "";
    for (const character of text) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined)
            continue;
        if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
            sanitized += character;
            continue;
        }
        if (codePoint <= 0x1f)
            continue;
        if (codePoint >= 0xd800 && codePoint <= 0xdfff)
            continue;
        if (codePoint >= 0xfff9 && codePoint <= 0xfffb)
            continue;
        sanitized += character;
    }
    return sanitized;
}
function removeBashExecutionFooter(output, details, isPartial) {
    if (isPartial
        || !details?.truncation?.truncated
        || !details.fullOutputPath
        || !output.endsWith("]")) {
        return output;
    }
    const footerStart = output.lastIndexOf("\n\n[");
    if (footerStart !== -1
        && output.slice(footerStart).includes(details.fullOutputPath)) {
        return output.slice(0, footerStart).trimEnd();
    }
    return output;
}
function formatBashTruncationWarning(details) {
    const truncation = details?.truncation;
    const warnings = [];
    if (details?.fullOutputPath) {
        warnings.push(`Full output: ${details.fullOutputPath}`);
    }
    if (truncation?.truncated) {
        if (truncation.truncatedBy === "lines") {
            warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
        }
        else {
            warnings.push(`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`);
        }
    }
    return warnings.join(". ");
}
function formatDuration(milliseconds) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
}
function parseEditDiff(details) {
    if (details.patch) {
        const parsed = parseUnifiedPatch(details.patch);
        if (parsed.length > 0)
            return parsed;
    }
    return parseDisplayDiff(details.diff);
}
function getPreparedEditDiff(state, details, path, theme) {
    if (state.preparedDiff
        && state.preparedDetails === details
        && state.preparedPath === path
        && state.preparedTheme === theme) {
        return state.preparedDiff;
    }
    const prepared = parseEditDiff(details);
    state.preparedDetails = details;
    state.preparedPath = path;
    state.preparedTheme = theme;
    state.preparedDiff = prepared;
    state.preparedStats = countDiffStats(prepared);
    state.layoutSource = undefined;
    state.collapsedLayouts = [];
    state.expandedLayout = undefined;
    return prepared;
}
function prepareDiffHighlights(lines, path) {
    const language = getLanguageFromPath(path);
    if (!language)
        return;
    for (const line of lines) {
        if (line.kind === "hunk" || line.highlightedText !== undefined)
            continue;
        line.highlightedText = highlightCode(line.text, language)[0] ?? line.text;
    }
}
function namedGreen(text) {
    return `${ANSI_NAMED_GREEN}${text}${ANSI_DEFAULT_FOREGROUND}`;
}
function namedRed(text) {
    return `${ANSI_NAMED_RED}${text}${ANSI_DEFAULT_FOREGROUND}`;
}
function applyCodeForeground(text, foregroundAnsi) {
    const restored = text
        .replace(ANSI_FULL_SGR_RESET, (reset) => `${reset}${foregroundAnsi}`)
        .replace(ANSI_FOREGROUND_RESET, (reset) => `${reset}${foregroundAnsi}`);
    return `${foregroundAnsi}${restored}${ANSI_DEFAULT_FOREGROUND}`;
}
function countDiffStats(lines) {
    let added = 0;
    let removed = 0;
    for (const line of lines) {
        if (line.kind === "added")
            added += 1;
        if (line.kind === "removed")
            removed += 1;
    }
    return { added, removed };
}
function extractText(content) {
    return content
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text ?? "")
        .join("\n");
}
function firstLine(text) {
    return text.split("\n", 1)[0] ?? "";
}
function getWriteMetrics(state, content, includeBytes) {
    let metrics = state.metrics;
    if (metrics?.content !== content) {
        metrics = {
            content,
            lineCount: countLines(content),
        };
        state.metrics = metrics;
    }
    if (includeBytes && metrics.bytes === undefined) {
        metrics.bytes = Buffer.byteLength(content, "utf8");
    }
    return metrics;
}
function countLines(content) {
    if (content.length === 0)
        return 0;
    let lineCount = 1;
    for (let index = 0; index < content.length; index += 1) {
        if (content.charCodeAt(index) === 0x0a)
            lineCount += 1;
    }
    return lineCount;
}
function formatLineCount(count) {
    return `${count} ${count === 1 ? "line" : "lines"}`;
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    const kibibytes = bytes / 1024;
    if (kibibytes < 1024) {
        return `${kibibytes >= 10 ? Math.round(kibibytes) : kibibytes.toFixed(1)} KB`;
    }
    const mebibytes = kibibytes / 1024;
    return `${mebibytes >= 10 ? Math.round(mebibytes) : mebibytes.toFixed(1)} MB`;
}
//# sourceMappingURL=tools.js.map