// PROTOTYPE: Deterministic display fixtures. None of these commands are executed.

export const SCENES = ["single", "mixed", "success", "long", "edge"] as const;
export type Scene = typeof SCENES[number];
export type Status = "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";

export interface BashFixture {
  id: string;
  command: string;
  output: string[];
  status: Status;
  durationMs: number;
  exitCode?: number;
  timeout?: number;
  truncated?: boolean;
}

const success = [
  "> pi-ext@0.1.0 check",
  "> pnpm run typecheck && pnpm test && pnpm run build",
  "",
  ...Array.from({ length: 14 }, (_, index) => `PASS render-case-${String(index + 1).padStart(2, "0")}.test.ts`),
  "Test Files  24 passed",
  "Tests       186 passed",
  "Build completed",
];
const failure = [
  "> vitest run",
  "",
  "PASS layout.test.ts",
  "FAIL rendering-pipeline.test.ts > keeps the output within the viewport",
  "AssertionError: expected 80, received 81",
  "  at rendering-pipeline.test.ts:128:9",
  "",
  ...Array.from({ length: 8 }, (_, index) => `PASS remaining-case-${index + 1}.test.ts`),
  "Test Files  1 failed | 23 passed",
  "Tests       1 failed | 185 passed",
  "Process exited with code 1",
];

export function fixturesFor(scene: Scene): BashFixture[] {
  const common = { timeout: 30 };
  const rows: Omit<BashFixture, "id">[] = scene === "single" ? [
    { ...common, command: 'git commit --amend -m "feat(codex-ui): 改进回复布局、编辑摘要与思考历史" -m "普通回复使用公开 Markdown 接口实现外层布局"',
      output: ["[fixture 861ba19] feat(codex-ui): 改进回复布局、编辑摘要与思考历史", "Fixture only. No commit was created."], status: "completed", durationMs: 100, exitCode: 0 },
  ] : scene === "mixed" || scene === "success" ? [
    { ...common, command: "git status --short", output: [" M extensions/codex-ui/src/tools.ts", "?? prototypes/codex-bash-ui-prototype/"], status: "completed", durationMs: 200, exitCode: 0 },
    { ...common, command: "pnpm run check", output: success, status: "completed", durationMs: 4200, exitCode: 0 },
    { ...common, command: "pnpm test", output: failure, status: "failed", durationMs: 1800, exitCode: 1 },
  ] : scene === "long" ? [
    { ...common, command: "git diff --check", output: [], status: "completed", durationMs: 100, exitCode: 0 },
    { timeout: 120, command: "pnpm run build", output: [
      ...Array.from({ length: 240 }, (_, index) => `transforming src/modules/module-${String(index + 1).padStart(3, "0")}.ts`),
      "dist/index.js  148.2 kB",
      "dist/index.css  12.8 kB",
      "Build completed in 14.1s",
    ], status: "completed", durationMs: 14100, exitCode: 0 },
    { ...common, command: "pnpm test -- --reporter=verbose", output: [
      ...Array.from({ length: 60 }, (_, index) => `PASS verbose-case-${index + 1}.test.ts`),
      ...failure,
    ], status: "failed", durationMs: 9400, exitCode: 1 },
  ] : [
    { ...common, command: "printf '%s\\n' '中文路径 / 非 ASCII / é / 👩‍💻'\nprintf '%s\\n' 'second command line'", output: ["中文路径 / 非 ASCII / é / 👩‍💻", "second command line", "\u001b[32mANSI green input is sanitized\u001b[0m", `long-token:${"abcdef".repeat(36)}`], status: "completed", durationMs: 200, exitCode: 0 },
    { timeout: 30, command: "pnpm run integration", output: ["Connecting to the fixture service…", "Waiting for readiness…", "Command timed out after 30 seconds"], status: "timeout", durationMs: 30000 },
    { timeout: 120, command: "pnpm run build -- --verbose", output: ["Only the captured output tail is available.", "transforming src/last-module.ts", "Build cancelled by user"], status: "cancelled", durationMs: 8200, truncated: true },
  ];
  if (scene === "success") rows[2] = {
    ...common, command: "pnpm run typecheck", output: ["Typecheck completed"], status: "completed", durationMs: 900, exitCode: 0,
  };
  return rows.map((row, index) => ({ ...row, id: `bash-lab-${index + 1}`, output: [...row.output] }));
}

export const LAST_FRAME = 12;

export function playbackRows(scene: Scene, frame: number | null): BashFixture[] {
  const rows = fixturesFor(scene);
  if (frame === null || frame >= LAST_FRAME) return rows;
  return rows.map((row, index) => {
    const start = index + 1;
    const end = 4 + index * 3;
    if (frame < start) return { ...row, status: "pending", output: [], durationMs: 0, exitCode: undefined, truncated: false };
    if (frame >= end) return row;
    const fraction = (frame - start + 1) / (end - start + 1);
    return {
      ...row,
      status: "running",
      output: row.output.slice(0, Math.floor(row.output.length * fraction)),
      durationMs: Math.round(row.durationMs * fraction),
      exitCode: undefined,
      truncated: false,
    };
  });
}

export function parseScene(value: string): Scene | undefined {
  return SCENES.find(scene => scene === value);
}
