import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const expectedPiVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).devDependencies["@earendil-works/pi-coding-agent"];
export const piPackageRoot = realpathSync(fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/", import.meta.url)));
export const piVersion = JSON.parse(readFileSync(join(piPackageRoot, "package.json"), "utf8")).version;

export function inspectPiHost(root = piPackageRoot, expected = expectedPiVersion) {
  root = realpathSync(root);
  const versions = Object.fromEntries(["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"].map(name =>
    [name, JSON.parse(readFileSync(join(dirname(root), name, "package.json"), "utf8")).version]));
  assert.equal(versions["pi-coding-agent"], expected, "Installed Pi runtime version mismatch");
  assert.equal(new Set(Object.values(versions)).size, 1, "Pi dependency versions differ");
  return { root, cli: join(root, "dist/cli.js"), node: process.version, versions };
}
