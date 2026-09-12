import { LabController } from "./controller.js";
import { playbackRows, type BashFixture, type Scene } from "./fixtures.js";

export function cliFixturesFor(scene: Scene, frame: number | null = null): BashFixture[] {
  const rows = playbackRows(scene, frame);
  if (scene === "long") return rows.map((row, index) => ({ ...row,
    command: index === 0 ? "git diff --check -- " + [
      "extensions/codex-ui/src/bash-group-layout.ts", "extensions/codex-ui/src/bash-groups.ts",
      "extensions/codex-ui/src/responsive-lines.ts", "extensions/codex-ui/src/render-cache.ts",
      "prototypes/codex-bash-ui-prototype/src/cli-renderers.ts",
      "prototypes/codex-bash-ui-prototype/src/cli-hybrid.ts", "fixtures/long-command-end.txt",
    ].join(" ") : index === 1 ? [
      "pnpm run build && \\", "  pnpm exec tsc --noEmit \\", "    --pretty false && \\",
      "  printf '%s\\n' '构建完成 · café 👩‍💻' 'multiline-command-end'",
    ].join("\n") : row.command,
  }));
  if (scene !== "single") return rows;
  const row = rows[0]!;
  const output = [
    "worktree /fixture/pi-ext", "HEAD 6d82444ebf3a8f72c0d200cef128488561faa114", "branch refs/heads/main", "",
  ];
  return [{ ...row,
    command: "git -C ~/Code/pi-ext worktree list --porcelain; git -C ~/Code/pi-ext status --short",
    output: row.status === "pending" ? [] : row.status === "running" ? output.slice(0, Math.max(0, frame ?? 0)) : output,
  }];
}

export class CliLabController extends LabController {
  override get rows(): BashFixture[] { return cliFixturesFor(this.scene, this.frame); }
}
