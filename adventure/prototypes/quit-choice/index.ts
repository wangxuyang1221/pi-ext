import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installBackend } from "./backend.js";

export default function (pi: ExtensionAPI): void {
  const record = (type: string, data: unknown = null) => appendFileSync(join(process.env.SKILL_PTY_ROOT!, "events.jsonl"), `${JSON.stringify({ type, data })}\n`);
  const backend = process.env.QUIT_PROBE_REAL === "1" ? installBackend(pi) : undefined;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    let pending = false;
    const previous = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const base = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      let submit = base.onSubmit;
      const gate = (text: string) => {
        if (text !== "/quit") return submit?.(text);
        if (pending) return;
        pending = true;
        ctx.ui.setEditorText("");
        void (async () => {
          if (backend) {
            const status = await backend.list(ctx);
            record("quit-status", status);
            if (status.diagnostics?.length) throw new Error(status.diagnostics.map((item: any) => item.reason).join("; "));
            if (status.capacity.pending) throw new Error("Subagent startup is still in progress; retry shortly.");
            if (!status.capacity.active) { record("quit-without-choice"); if (!ctx.isIdle()) ctx.abort(); ctx.shutdown(); return; }
          }
          record("quit-choice-open");
          const choice = await ctx.ui.select("Leave this session?", ["End session", "Leave temporarily"]);
          record("quit-choice", choice ?? "cancel");
          if (choice && !ctx.isIdle()) { record("quit-root-abort"); ctx.abort(); }
          if (choice === "End session" && backend) {
            await backend.close(ctx);
            const remaining = await backend.list(ctx);
            record("quit-cleaned", remaining);
            if (remaining.diagnostics?.length || remaining.capacity.active || remaining.capacity.pending) throw new Error("Subagent cleanup could not be confirmed.");
          }
          pending = false;
          if (choice) ctx.shutdown();
        })().catch(error => {
          pending = false;
          record("quit-choice-error", String(error));
          ctx.ui.notify(String(error), "error");
        });
      };
      base.onSubmit = gate;
      const bound = new Map<PropertyKey, unknown>();
      return new Proxy(base, {
        get(target, key) {
          if (key === "onSubmit") return submit;
          const value = Reflect.get(target, key, target);
          if (typeof value !== "function") return value;
          if (!bound.has(key)) bound.set(key, value.bind(target));
          return bound.get(key);
        },
        set(target, key, value) {
          if (key === "onSubmit") { submit = value; target.onSubmit = gate; return true; }
          return Reflect.set(target, key, value, target);
        },
      });
    });
    record("quit-adapter-installed");
  });
}
