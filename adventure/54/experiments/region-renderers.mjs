import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Probe a retained-frame fast path with fixture-supplied row bounds. The native
// differential writers remain intact. Production registration/geometry tracking,
// layout metadata updates, selection, images and overlays are not implemented.
export async function loadRegionRenderers() {
  const sourceRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-tui")));
  mkdirSync(resolve(".tmp"), { recursive: true });
  const scratch = mkdtempSync(resolve(".tmp/region-renderers-"));
  const replace = (source, before, after) => {
    assert.equal(source.split(before).length, 2, `Expected exactly one host fragment: ${before}`);
    return source.replace(before, after);
  };
  const load = async (name, transform) => {
    let source = transform(readFileSync(join(sourceRoot, name), "utf8"));
    source = source.replace(/from "(\.[^"]+)"/g, (_, relative) => `from ${JSON.stringify(pathToFileURL(resolve(sourceRoot, relative)).href)}`);
    const path = join(scratch, name);
    writeFileSync(path, source);
    return import(pathToFileURL(path).href);
  };
  try {
    const regular = await load("tui-main-screen.js", source => {
      source = replace(source, "let newLines = this.resolveFakeCursors(this.render(width));", "const partial = this.experimentalRegionFrame?.(width, height);\n        let newLines = partial?.lines ?? this.resolveFakeCursors(this.render(width));");
      source = replace(source, "const cursorPos = this.extractCursorPosition(newLines, height);", "const cursorPos = partial ? partial.cursorPos : this.extractCursorPosition(newLines, height);\n        this.experimentalCursor = cursorPos;");
      source = replace(source, "newLines = this.applyLineResets(newLines);", "if (!partial) newLines = this.applyLineResets(newLines);");
      return source;
    });
    const fullscreen = await load("tui-alt-screen.js", source => {
      const start = "        const root = this.layoutRoot ?? this.implicitScrollView;\n        let nextLayout = renderLayoutFrame";
      source = replace(source, start, "        const partial = this.experimentalRegionFrame?.(width, height);\n        let nextLayout, screen, cursorPos;\n        if (partial) {\n            nextLayout = this.currentLayout;\n            screen = partial.lines;\n            cursorPos = partial.cursorPos;\n        } else {\n        const root = this.layoutRoot ?? this.implicitScrollView;\n        nextLayout = renderLayoutFrame");
      source = replace(source, "        let screen = this.resolveFakeCursors(nextLayout.lines.map", "        screen = this.resolveFakeCursors(nextLayout.lines.map");
      source = replace(source, "        const cursorPos = this.extractCursorPosition(screen, height);", "        cursorPos = this.extractCursorPosition(screen, height);");
      source = replace(source, "        const fullRedraw = this.previousScreen.length === 0", "        }\n        this.experimentalCursor = cursorPos;\n        const fullRedraw = this.previousScreen.length === 0");
      return source;
    });
    return { ...regular, ...fullscreen, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}
