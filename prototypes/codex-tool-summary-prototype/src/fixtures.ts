// PROTOTYPE: Named restoration fixtures; no service or filesystem execution.
export const MCP_NAME = "mcp__context7__resolve-library-id";
export const SCENES = ["success", "long", "error"] as const;
export type Scene = typeof SCENES[number];
export interface Fixture {
  id: string;
  name: string;
  args: Record<string, string>;
  text: string;
  isError: boolean;
}

export function fixturesFor(scene: Scene): Fixture[] {
  const long = scene === "long";
  const isError = scene === "error";
  return [
    {
      id: "summary-mcp", name: MCP_NAME,
      args: { libraryName: long ? "TypeScript / terminal rendering / 中文路径 / " + "responsive-width-".repeat(10) : "TypeScript" },
      text: isError ? "Connection failed: fixture server unavailable"
        : "Available Libraries:\n\n" + ["TypeScript", "TypeScript documentation", "TypeScript examples"].map((name, index) =>
          `Title: ${name}\nLibrary ID: /fixture/typescript-${index}\nDescription: Typed JavaScript for application development.\nSource: fixture, not a live lookup.\n`).join("\n"),
      isError,
    },
    {
      id: "summary-write", name: "write",
      args: { path: long ? "src/中文目录/" + "deeply-nested-component/".repeat(7) + "config.ts" : "src/config.ts",
        content: Array.from({ length: 20 }, (_, i) => `export const setting${i + 1} = ${i + 1};`).join("\n") },
      text: isError ? "Write failed: permission denied for src/config.ts" : "Successfully wrote fixture content to src/config.ts",
      isError,
    },
    {
      id: "summary-json", name: MCP_NAME, args: { libraryName: "TypeScript" },
      text: JSON.stringify({ source: "fixture", libraries: [{ id: "/fixture/typescript", title: "TypeScript", score: 99 }], total: 1 }),
      isError: false,
    },
  ];
}
