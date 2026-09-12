import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import codexUiExtension from "../../../extensions/codex-ui/src/index.js";
import { CodexFooter } from "../../../extensions/codex-ui/src/footer.js";
import { GoalPreviewClock } from "./clock.js";
import { formatExact, GOAL_FIXTURE, GoalPreviewFooter } from "./view.js";

export default function goalFooterPrototype(pi: ExtensionAPI): void {
  if (process.env.GOAL_FOOTER_PROTOTYPE !== "1") {
    throw new Error("Use pnpm run prototype:goal-footer to launch the isolated prototype.");
  }
  codexUiExtension(pi);
  const clock = new GoalPreviewClock();

  const commands = ["pause", "resume", "complete", "boundary", "reset", "fresh", "hour", "help"];
  const apply = (action: string) => {
    switch (action) {
      case "pause": clock.setStatus("paused"); return;
      case "resume": clock.setStatus("active"); return;
      case "complete": clock.setStatus("complete"); return;
      case "boundary": clock.reset(778_000); return;
      case "reset": clock.reset(); return;
      case "fresh": clock.reset(0); return;
      case "hour": clock.reset(3_598_000); return;
    }
  };
  const showDetails = async (ctx: ExtensionContext) => {
    const snapshot = clock.snapshot();
    const action = await ctx.ui.custom<string | undefined>((_tui, theme, _keys, done) => {
      const details = new Text([
        theme.bold("Goal details") + theme.fg("dim", " · fixture snapshot"),
        "",
        GOAL_FIXTURE.objective,
        "",
        `Status          ${snapshot.status}`,
        `Elapsed         ${formatExact(snapshot.elapsedSeconds)}`,
        `Tokens          ${GOAL_FIXTURE.tokensUsed.toLocaleString("en-US")} / ${GOAL_FIXTURE.tokenBudget.toLocaleString("en-US")}`,
        `Remaining       ${(GOAL_FIXTURE.tokenBudget - GOAL_FIXTURE.tokensUsed).toLocaleString("en-US")}`,
        `Timer wakeups   ${snapshot.timerWakeups}`,
        "",
        theme.fg("muted", "Footer updates at elapsed-minute boundaries. No per-second timer."),
        theme.fg("dim", "Exact time is sampled on opening. Reopen to refresh."),
        "",
        theme.fg("accent", "[p] Pause   [r] Resume   [c] Complete   [b] Boundary   [esc] Close"),
      ].join("\n"), 1, 1);
      return {
        render: (width: number) => details.render(width),
        invalidate: () => details.invalidate(),
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "enter")) done(undefined);
          else if (data === "p") done("pause");
          else if (data === "r") done("resume");
          else if (data === "c") done("complete");
          else if (data === "b") done("boundary");
        },
      };
    });
    if (action) apply(action);
  };

  pi.registerCommand("goal", {
    description: "Preview goal details or pause/resume/complete/boundary/reset/fresh/hour",
    getArgumentCompletions(prefix) {
      return commands.filter(action => action.startsWith(prefix)).map(value => ({ value, label: value }));
    },
    async handler(args, ctx) {
      const action = args.trim();
      if (!action) { await showDetails(ctx); return; }
      if (action === "help" || !commands.includes(action)) {
        ctx.ui.notify("Fixture controls: /goal · /goal pause · /goal resume · /goal complete · /goal boundary · /goal fresh · /goal hour · /goal reset · /quit", "info");
        return;
      }
      apply(action);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    clock.reset();
    pi.setActiveTools([]);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      const base = new CodexFooter({
        cwd: ctx.cwd,
        home: process.env.HOME,
        getModelId: () => ctx.model?.id,
        getThinkingLevel: () => pi.getThinkingLevel(),
        getContextUsage: () => ctx.getContextUsage(),
        getBranch: () => footerData.getGitBranch(),
        getExtensionStatuses: () => footerData.getExtensionStatuses(),
        getTheme: () => ctx.ui.theme,
      });
      base.setBranchSubscription(footerData.onBranchChange(() => {
        base.invalidate();
        tui.requestRender();
      }));
      const footer = new GoalPreviewFooter(base, () => clock.snapshot(), () => ctx.ui.theme);
      clock.start(() => tui.requestRender());
      return {
        render: (width: number) => footer.render(width),
        invalidate: () => footer.invalidate(),
        dispose() { clock.dispose(); footer.dispose(); },
      };
    });
  });
  pi.on("session_shutdown", () => clock.dispose());

  // The isolated preview never starts a model turn or executes user shell input.
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("Offline fixture. Use /goal help for preview controls.", "info");
    return { action: "handled" };
  });
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this prototype.", exitCode: 0, cancelled: false, truncated: false } }));
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("before_provider_request", () => { throw new Error("Model requests are disabled in this prototype."); });
}
