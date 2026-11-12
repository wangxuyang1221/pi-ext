import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ScrollView, TuiMainScreen, TuiAltScreen, type Terminal } from "@earendil-works/pi-tui";

const version = JSON.parse(readFileSync(resolve("node_modules/@earendil-works/pi-tui/package.json"), "utf8")).version;
describe.skipIf(version !== "1.5.2")("Pi 1.5.2 upstream rendering contracts", () => {
  it.each([["regular", TuiMainScreen], ["fullscreen", TuiAltScreen]] as const)("strips prompt zones without ending program status in %s", (_mode, Host) => {
    let output = "", value = "first";
    const terminal = { columns: 60, rows: 12, write(text: string) { output += text; }, hideCursor() {}, showCursor() {}, stop() {} } as unknown as Terminal;
    const host = new Host(terminal, true);
    const component = { invalidate() {}, render: () => [`\x1b]133;A\x07\x1b]133;B\x1b\\\x1b]7501;S=working\x07${value}`] };
    host.addChild(component);
    if (host instanceof TuiAltScreen) Object.assign(host, { altScreenActive: true });
    const handle = host.registerTextRegion!(component);
    try {
      for (const next of ["first", "second", "x"]) {
        value = next; output = "";
        handle.requestRender();
        const flush = host as unknown as { cancelRenderTimer(): void; renderRequested: boolean; doRender(): void };
        flush.cancelRenderTimer(); flush.renderRequested = false; flush.doRender();
        expect(output).not.toContain("\x1b]133;");
        expect(output).toContain("\x1b]7501;S=working\x07");
        expect(output).not.toContain("\x1b]7501;S=done");
      }
    } finally { handle.dispose(); host.stop(); }
  });

  it("crops images across both viewport edges and bounds lookback", async () => {
    const image = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-tui/dist/terminal-image.js")).href);
    const layout = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-tui/dist/layout.js")).href);
    image.registerKittyImageMetadata({ imageId: 90152, rows: 6, columns: 10, widthPx: 100, heightPx: 120 });
    const line = "\x1b_Ga=T,f=100,i=90152,r=6,c=10;AAAA\x1b\\";
    const document = { invalidate() {}, render: () => [line, "padding", "border", "placeholder", "", "", "after"] };
    const scroll = new ScrollView(document, { scrollbar: "hidden", follow: "none" });
    layout.renderLayoutFrame(scroll, 40, 3, () => {});
    scroll.scrollTo(2);
    const frame = layout.renderLayoutFrame(scroll, 40, 3, () => {});
    expect(frame.lines[0]).toContain("y=40,h=60,r=3");
    scroll.scrollTo(0);
    const bottom = layout.renderLayoutFrame(scroll, 40, 3, () => {});
    expect(bottom.lines[0]).toContain("y=0,h=60,r=3");
    let accesses = 0;
    const lines = new Proxy(Array.from({ length: 10000 }, () => "text"), { get(target, key, receiver) { if (/^\d+$/.test(String(key))) accesses++; return Reflect.get(target, key, receiver); } });
    document.render = () => lines;
    layout.renderLayoutFrame(scroll, 40, 3, () => {});
    accesses = 0;
    scroll.scrollTo(9000);
    layout.renderLayoutFrame(scroll, 40, 3, () => {});
    expect(accesses).toBeLessThanOrEqual(image.getMaxKittyImageRows() + 10);
  });
});
