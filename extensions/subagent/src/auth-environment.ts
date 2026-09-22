import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";

// Pi's source-extension loader aliases the pi-ai root to compat; resolve the
// published compat entry explicitly so source and built extensions agree.
let api: Promise<typeof import("@earendil-works/pi-ai/compat")> | undefined;

export async function providerEnvironment(model: string | undefined, env: Record<string, string | undefined>): Promise<Record<string, string>> {
  if (!model?.includes("/")) return {};
  const provider = model.slice(0, model.indexOf("/"));
  api ??= import(new URL("./dist/compat.js", pathToFileURL(findPackageJSON("@earendil-works/pi-ai", import.meta.url)!)).href);
  const { findEnvKeys } = await api;
  const defined = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return Object.fromEntries((findEnvKeys(provider, defined) ?? []).filter(key => !!defined[key]).map(key => [key, defined[key]!]));
}

export function privateEnvironmentScript(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) throw new Error("Invalid authentication environment key");
    return `export ${key}='${value.replaceAll("'", `'"'"'`)}'`;
  }).join("\n") + "\n";
}
