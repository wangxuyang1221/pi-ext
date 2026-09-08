// PROTOTYPE: Named, deterministic fixtures. No workspace files are read.
export const SCENES = ["single", "batch", "long", "error"] as const;
export type Scene = typeof SCENES[number];
export interface ReadFixture {
  id: string;
  args: { path: string; offset?: number; limit?: number };
  text: string;
  isError?: boolean;
  truncated?: boolean;
}
const policy = ["# Repository language policy", "", "Use the language assigned to each artifact.",
  ...Array.from({ length: 28 }, (_, i) => `Fixture policy rule ${i + 1}.`)].join("\n");
export function fixturesFor(scene: Scene): ReadFixture[] {
  const first = { id: "read-policy", args: { path: "docs/agents/repository-language-policy.md" }, text: policy };
  if (scene === "single") return [first];
  if (scene === "error") return [first, { id: "read-missing", args: { path: "src/missing.ts" }, text: "ENOENT: no such file or directory", isError: true }];
  if (scene === "long") return [{ id: "read-long", args: { path: "packages/platform/extensions/codex-ui/src/components/read-tool/repository-language-policy.md", offset: 120, limit: 6 },
    text: ["export const readLayout = {", "  filename: 'repository-language-policy.md',", "  path: 'packages/platform/extensions/codex-ui/src/components/read-tool',", "  preview: true,", "  maxRows: 6,", "};"].join("\n"), truncated: true }];
  return [first,
    { id: "read-package", args: { path: "package.json" }, text: '{\n  "name": "read-ui-fixture",\n  "private": true\n}' },
    { id: "read-index", args: { path: "extensions/codex-ui/src/index.ts", offset: 20, limit: 4 }, text: 'export function activate() {\n  const layout = "compact";\n  return layout;\n}' },
  ];
}
