import { constants } from "node:fs";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { createWriteToolDefinition, generateUnifiedPatch, } from "@earendil-works/pi-coding-agent";
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_INPUT_LINES = 4000;
const MAX_PATCH_BYTES = 2 * 1024 * 1024;
function countLines(text) {
    let lines = 0;
    let offset = 0;
    while (offset < text.length) {
        if (++lines > MAX_INPUT_LINES)
            break;
        const next = text.indexOf("\n", offset);
        if (next === -1)
            break;
        offset = next + 1;
    }
    return lines;
}
async function readSnapshot(path) {
    // Nonblocking open avoids hanging if an external process replaces a file with a FIFO.
    const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_TEXT_BYTES)
            return undefined;
        const buffer = Buffer.alloc(Math.min(MAX_TEXT_BYTES + 1, info.size + 1));
        let offset = 0;
        while (offset < buffer.length) {
            const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
            if (bytesRead === 0) {
                const bytes = buffer.subarray(0, offset);
                if (bytes.includes(0))
                    return undefined;
                return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            }
            offset += bytesRead;
        }
        // The file grew since stat. Do not present a partial snapshot as a complete diff.
        return undefined;
    }
    finally {
        await handle.close();
    }
}
/** Capture local write metadata inside the built-in mutation queue, isolated per call. */
export function createObservedWriteDefinition(cwd, isLowPowerEnabled = () => false) {
    const base = createWriteToolDefinition(cwd);
    return {
        ...base,
        renderResult(result, options, theme, context) {
            return base.renderResult({ ...result, details: undefined }, options, theme, context);
        },
        async execute(id, params, signal, onUpdate, context) {
            const lowPower = isLowPowerEnabled();
            const change = { version: 1 };
            let oldContent;
            let writtenContent;
            const displayPath = params.path;
            const observed = createWriteToolDefinition(cwd, {
                operations: {
                    mkdir: async (directory) => { await mkdir(directory, { recursive: true }); },
                    async writeFile(path, content) {
                        // These operations run after permission checks and inside Pi's existing queue.
                        // Display capture must never turn an otherwise writable file into a failure.
                        try {
                            const capture = !lowPower && content.length <= MAX_TEXT_BYTES
                                && Buffer.byteLength(content, "utf8") <= MAX_TEXT_BYTES
                                && countLines(content) <= MAX_INPUT_LINES && !content.includes("\0");
                            const info = await stat(path);
                            change.action = "Edited";
                            if (capture && info.isFile() && info.size <= MAX_TEXT_BYTES)
                                oldContent = await readSnapshot(path);
                        }
                        catch (error) {
                            if (change.action === undefined && error.code === "ENOENT") {
                                change.action = "Added";
                                if (!lowPower && content.length <= MAX_TEXT_BYTES
                                    && Buffer.byteLength(content, "utf8") <= MAX_TEXT_BYTES
                                    && countLines(content) <= MAX_INPUT_LINES)
                                    oldContent = "";
                            }
                        }
                        await writeFile(path, content, "utf8");
                        writtenContent = content;
                    },
                },
            });
            try {
                const result = await observed.execute(id, params, signal, onUpdate, context);
                try {
                    if (oldContent !== undefined && writtenContent !== undefined && !writtenContent.includes("\0")
                        && countLines(oldContent) + countLines(writtenContent) <= MAX_INPUT_LINES) {
                        const encodedContent = Buffer.from(writtenContent, "utf8").toString("utf8");
                        const patch = generateUnifiedPatch(displayPath, oldContent, encodedContent);
                        if (patch.length <= MAX_PATCH_BYTES && Buffer.byteLength(patch, "utf8") <= MAX_PATCH_BYTES)
                            change.patch = patch;
                    }
                }
                catch {
                    // Preserve the successful built-in result if display metadata cannot be computed.
                }
                return { ...result, details: { codexWrite: change } };
            }
            finally {
                oldContent = undefined;
                writtenContent = undefined;
            }
        },
    };
}
//# sourceMappingURL=write-changes.js.map