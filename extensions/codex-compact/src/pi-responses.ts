import { readFileSync } from "node:fs";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, resolve } from "node:path";

// Pi 0.86.0 aliases pi-ai/* imports to compat.js/* in filesystem extensions.
// Resolve the package's declared public export through Node, outside that alias.
// Keep this version-bound adapter covered by a real DefaultResourceLoader test.
const manifestPath = findPackageJSON("@earendil-works/pi-ai", import.meta.url)!;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const apiPath = manifest.exports["./api/*"].import.replace("*", "openai-responses-shared");
export const { convertResponsesTools } = createRequire(import.meta.url)(resolve(dirname(manifestPath), apiPath)) as
  typeof import("@earendil-works/pi-ai/api/openai-responses-shared");
