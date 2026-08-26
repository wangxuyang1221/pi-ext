import { isAbsolute, relative, sep } from "node:path";
import { createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition, DEFAULT_MAX_BYTES, formatSize, keyHint, truncateToVisualLines, } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi, } from "@earendil-works/pi-tui";
import { fitToWidth, formatHomePath, normalizeWidth, } from "./layout.js";
const COLLAPSED_BASH_LINES = 5;
const COLLAPSED_DIFF_LINES = 12;
const EXPANDED_READ_LINES = 40;
const BASH_DURATION_REFRESH_MS = 1000;
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
class ResponsiveLinesComponent {
    renderer = () => [];
    setRenderer(renderer) {
        this.renderer = renderer;
    }
    render(width) {
        const safeWidth = normalizeWidth(width);
        if (safeWidth === 0)
            return [];
        return this.renderer(safeWidth)
            .map((line) => fitToWidth(line, safeWidth));
    }
    invalidate() { }
}
export function registerCodexTools(pi, factories = DEFAULT_FACTORIES, services = {}) {
    const getReadDefinition = createDefinitionCache(factories.read);
    const getEditDefinition = createDefinitionCache(factories.edit);
    const getWriteDefinition = createDefinitionCache(factories.write);
    const getBashDefinition = createDefinitionCache(factories.bash);
    const baseRead = getReadDefinition(process.cwd());
    const readTool = {
        ...baseRead,
        renderShell: "self",
        execute(toolCallId, params, signal, onUpdate, ctx) {
            return getReadDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
            const path = formatToolPath(args.path, context.cwd);
            const range = formatReadRange(args.offset, args.limit, theme);
            return updateComponent(context.lastComponent, (width) => [
                fitToWidth(formatToolTitle("Read", path, theme, range), width),
            ]);
        },
        renderResult(result, options, theme, context) {
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
            state.initialTitle = formatToolTitle("Edit", path, theme);
            const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
            state.callComponent = component;
            component.setRenderer((width) => [
                fitToWidth(state.settledTitle ?? state.initialTitle ?? "", width),
            ]);
            return component;
        },
        renderResult(result, options, theme, context) {
            const state = context.state;
            const path = state.path ?? formatToolPath(context.args.path, context.cwd);
            const details = result.details;
            let nextTitle;
            if (options.isPartial) {
                nextTitle = formatToolTitle("Editing", path, theme, theme.fg("warning", "…"));
            }
            else if (context.isError) {
                nextTitle = formatToolTitle("Edit failed", path, theme);
            }
            else if (details?.diff) {
                const stats = countDiffStats(parseDisplayDiff(details.diff));
                const suffix = `(${theme.fg("success", `+${stats.added}`)} ${theme.fg("error", `−${stats.removed}`)})`;
                nextTitle = formatToolTitle("Edited", path, theme, suffix);
            }
            else {
                nextTitle = formatToolTitle("Edited", path, theme);
            }
            if (state.settledTitle !== nextTitle) {
                state.settledTitle = nextTitle;
            }
            return updateComponent(context.lastComponent, (width) => renderEditResult(result, details, options, theme, context.isError, width));
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
            const path = formatToolPath(args.path, context.cwd);
            const lineCount = countLines(args.content);
            const suffix = theme.fg("dim", `(${formatLineCount(lineCount)})`);
            return updateComponent(context.lastComponent, (width) => [
                fitToWidth(formatToolTitle("Write", path, theme, suffix), width),
            ]);
        },
        renderResult(result, options, theme, context) {
            return updateComponent(context.lastComponent, (width) => renderWriteResult(result, context.args.content, options.isPartial, theme, context.isError, width));
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
            updateBashLifecycle(state, context);
            const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
            state.callComponent = component;
            component.setRenderer((width) => renderBashCall(args, state, theme, width));
            return component;
        },
        renderResult(result, options, theme, context) {
            return updateComponent(context.lastComponent, (width) => renderBashResult(result, options, theme, services, width));
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
        return {
            kind,
            lineNumber: match ? Number.parseInt(match[1] ?? "", 10) : undefined,
            text: match ? (match[2] ?? "") : body.trimStart(),
        };
    });
}
export function renderDisplayDiff(lines, theme, width) {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0)
        return [];
    const lineNumberWidth = Math.max(1, ...lines.map((line) => line.lineNumber === undefined ? 0 : String(line.lineNumber).length));
    return lines.map((line) => {
        const lineNumber = line.lineNumber === undefined
            ? " ".repeat(lineNumberWidth)
            : String(line.lineNumber).padStart(lineNumberWidth);
        const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
        const color = line.kind === "added"
            ? "toolDiffAdded"
            : line.kind === "removed"
                ? "toolDiffRemoved"
                : "toolDiffContext";
        const content = `${theme.fg("dim", lineNumber)} ${theme.fg(color, marker)} ${theme.fg(color, line.text)}`;
        if (line.kind === "added") {
            return theme.bg("toolSuccessBg", fitToWidth(content, safeWidth, { pad: true }));
        }
        if (line.kind === "removed") {
            return theme.bg("toolErrorBg", fitToWidth(content, safeWidth, { pad: true }));
        }
        return fitToWidth(content, safeWidth);
    });
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
    component.setRenderer(renderer);
    return component;
}
function formatToolTitle(action, path, theme, suffix = "") {
    const parts = [
        theme.fg("dim", "•"),
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
    let summary = hasImage ? "Image loaded" : formatLineCount(lineCount);
    if (result.details?.truncation?.truncated) {
        summary += " · truncated";
    }
    const lines = [theme.fg("success", `  └ ${summary}`)];
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
function renderEditResult(result, details, options, theme, isError, width) {
    if (options.isPartial) {
        return [fitToWidth(theme.fg("warning", "  … Editing"), width)];
    }
    if (isError) {
        const error = firstLine(extractText(result.content)) || "Edit failed";
        return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
    }
    if (!details?.diff) {
        return [fitToWidth(theme.fg("success", "  └ Applied"), width)];
    }
    const parsed = parseDisplayDiff(details.diff);
    const maximum = options.expanded ? parsed.length : COLLAPSED_DIFF_LINES;
    const visible = parsed.slice(0, maximum);
    const lines = renderDisplayDiff(visible, theme, width);
    const remaining = parsed.length - visible.length;
    if (remaining > 0) {
        lines.push(fitToWidth(theme.fg("dim", `… ${remaining} more diff lines`), width));
    }
    return lines;
}
function renderWriteResult(result, content, isPartial, theme, isError, width) {
    if (isPartial) {
        return [fitToWidth(theme.fg("warning", "  … Writing"), width)];
    }
    if (isError) {
        const error = firstLine(extractText(result.content)) || "Write failed";
        return [fitToWidth(theme.fg("error", `  ✗ ${error}`), width)];
    }
    const summary = `  └ Written · ${formatLineCount(countLines(content))} · ${formatBytes(Buffer.byteLength(content, "utf8"))}`;
    return [fitToWidth(theme.fg("success", summary), width)];
}
function updateBashLifecycle(state, context) {
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
        if (state.interval === undefined) {
            state.interval = setInterval(() => context.invalidate(), BASH_DURATION_REFRESH_MS);
        }
    }
    else if (nextStatus === "completed" || nextStatus === "failed") {
        if (state.startedAt !== undefined && state.endedAt === undefined) {
            state.endedAt = Date.now();
        }
        if (state.interval !== undefined) {
            clearInterval(state.interval);
            state.interval = undefined;
        }
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
    lines.push(...renderBashCommand(args.command, theme, width));
    return lines;
}
function renderBashCommand(command, theme, width) {
    const displayCommand = sanitizeBashDisplayText(stripTerminalSequences(typeof command === "string" ? command : "")) || "…";
    const text = theme.fg("toolTitle", theme.bold(`$ ${displayCommand}`));
    const rail = width >= 2 ? theme.fg("success", "▌") : "";
    const gap = width >= 3 ? " " : "";
    const trailingPadding = width >= 4 ? 1 : 0;
    const prefix = `${rail}${gap}`;
    const contentWidth = Math.max(1, width - visibleWidth(prefix) - trailingPadding);
    const commandLines = wrapTextWithAnsi(text, contentWidth);
    return (commandLines.length > 0 ? commandLines : [""]).map((line) => theme.bg("toolPendingBg", fitToWidth(`${prefix}${line}`, width, { pad: true })));
}
function renderBashResult(result, options, theme, services, width) {
    let output = extractBashOutput(result.content).trim();
    output = removeBashExecutionFooter(output, result.details, options.isPartial);
    let visualLines = [];
    let skippedCount = 0;
    if (output) {
        const styledOutput = output
            .split("\n")
            .map((line) => theme.fg("toolOutput", line))
            .join("\n");
        const preview = truncateToVisualLines(styledOutput, options.expanded ? Number.MAX_SAFE_INTEGER : COLLAPSED_BASH_LINES, width);
        visualLines = preview.visualLines;
        skippedCount = preview.skippedCount;
    }
    const lines = ["", ...visualLines];
    const warning = formatBashTruncationWarning(result.details);
    if (warning) {
        lines.push("", ...wrapTextWithAnsi(theme.fg("warning", `[${warning}]`), width));
    }
    const totalVisualLines = visualLines.length + skippedCount;
    const lineLabel = `${totalVisualLines} visual ${totalVisualLines === 1 ? "line" : "lines"}`;
    const footerLabel = !options.expanded && skippedCount > 0
        ? `${skippedCount} earlier visual lines hidden`
        : lineLabel;
    lines.push("", ...renderAlignedLines(theme.fg("dim", footerLabel), formatExpandHint(options.expanded ? "collapse" : "expand", theme, services), width));
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
    return content
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => sanitizeBashDisplayText(stripTerminalSequences(item.text ?? "")).replace(/\r/g, ""))
        .join("\n");
}
function sanitizeBashDisplayText(text) {
    return Array.from(text)
        .filter((character) => {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined)
            return false;
        if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d)
            return true;
        if (codePoint <= 0x1f)
            return false;
        if (codePoint >= 0xd800 && codePoint <= 0xdfff)
            return false;
        return codePoint < 0xfff9 || codePoint > 0xfffb;
    })
        .join("");
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
function countLines(content) {
    return content.length === 0 ? 0 : content.split("\n").length;
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