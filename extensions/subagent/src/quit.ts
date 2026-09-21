import {
  CustomEditor,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { EditorComponent } from "@earendil-works/pi-tui";

import type {
  ManagedAgentList,
  SubagentManager,
} from "./manager.js";

type QuitManager = Pick<SubagentManager, "list" | "close">;

export interface SubagentQuitSession {
  installEditor(): void;
  invalidate(): void;
}

const END_SESSION = "End session";
const LEAVE_TEMPORARILY = "Leave temporarily";

/** Bind the /quit decision to one root session context. */
export function createSubagentQuitSession(
  ctx: ExtensionContext,
  manager: QuitManager,
): SubagentQuitSession {
  const sessionId = ctx.sessionManager.getSessionId();
  const controller = new AbortController();
  let active = true;
  let installed = false;

  const isCurrent = (): boolean => active
    && ctx.sessionManager.getSessionId() === sessionId;

  const abortMainAgent = (): void => {
    if (!ctx.isIdle()) ctx.abort();
  };

  const notifyError = (error: unknown): void => {
    if (isCurrent()) ctx.ui.notify(errorMessage(error), "error");
  };

  const runQuit = async (): Promise<void> => {
    let status: ManagedAgentList;
    try {
      status = await manager.list(sessionId, controller.signal);
    } catch (error) {
      throw new Error(`Could not check subagents: ${errorMessage(error)}`, { cause: error });
    }
    if (!isCurrent()) return;
    assertReliableStatus(status);
    if (status.capacity.pending > 0) {
      throw new Error("Subagent startup is still in progress; retry /quit shortly.");
    }
    if (status.capacity.active === 0) {
      abortMainAgent();
      if (isCurrent()) ctx.shutdown();
      return;
    }

    const choice = await ctx.ui.select(
      "Leave this session?",
      [END_SESSION, LEAVE_TEMPORARILY],
    );
    if (!isCurrent() || choice === undefined) return;
    abortMainAgent();

    if (choice === END_SESSION) {
      try {
        await manager.close(sessionId, "all", controller.signal);
      } catch (error) {
        throw new Error(`Could not end the session: ${errorMessage(error)}`, { cause: error });
      }
      if (!isCurrent()) return;
      let remaining: ManagedAgentList;
      try {
        remaining = await manager.list(sessionId, controller.signal);
      } catch (error) {
        throw new Error(`Subagent cleanup could not be confirmed: ${errorMessage(error)}`, { cause: error });
      }
      if (!isCurrent()) return;
      if (remaining.diagnostics?.length || remaining.capacity.active > 0 || remaining.capacity.pending > 0) {
        throw new Error(`Subagent cleanup could not be confirmed${statusDetails(remaining)}.`);
      }
    }

    if (isCurrent()) ctx.shutdown();
  };

  return {
    installEditor() {
      if (installed || !isCurrent() || ctx.mode !== "tui") return;
      installed = true;
      const previous = ctx.ui.getEditorComponent();
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const base = previous?.(tui, theme, keybindings)
          ?? new CustomEditor(tui, theme, keybindings);
        return interceptQuit(base, ctx, isCurrent, runQuit, notifyError);
      });
    },
    invalidate() {
      if (!active) return;
      active = false;
      controller.abort(new Error("Subagent quit session was replaced"));
    },
  };
}

function interceptQuit(
  base: EditorComponent,
  ctx: ExtensionContext,
  isCurrent: () => boolean,
  runQuit: () => Promise<void>,
  notifyError: (error: unknown) => void,
): EditorComponent {
  let downstream = base.onSubmit;
  let pending = false;
  const gate = (text: string): void => {
    if (text.trim() !== "/quit") {
      downstream?.(text);
      return;
    }
    if (pending || !isCurrent()) return;
    pending = true;
    ctx.ui.setEditorText("");
    void runQuit()
      .catch(notifyError)
      .finally(() => { pending = false; });
  };
  base.onSubmit = gate;
  const methods = new Map<PropertyKey, { source: Function; bound: Function }>();
  return new Proxy(base, {
    get(target, key) {
      if (key === "onSubmit") return downstream;
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      let cached = methods.get(key);
      if (!cached || cached.source !== value) {
        cached = { source: value, bound: value.bind(target) };
        methods.set(key, cached);
      }
      return cached.bound;
    },
    set(target, key, value) {
      if (key === "onSubmit") {
        downstream = value as EditorComponent["onSubmit"];
        target.onSubmit = gate;
        return true;
      }
      return Reflect.set(target, key, value, target);
    },
  });
}

function assertReliableStatus(status: ManagedAgentList): void {
  if (status.diagnostics?.length) {
    throw new Error(`Could not verify subagent status${statusDetails(status)}.`);
  }
}

function statusDetails(status: ManagedAgentList): string {
  const diagnostics = status.diagnostics?.map(item => `${item.agentId}: ${item.reason}`) ?? [];
  if (status.capacity.active > 0) diagnostics.push(`${status.capacity.active} active`);
  if (status.capacity.pending > 0) diagnostics.push(`${status.capacity.pending} starting`);
  return diagnostics.length ? `: ${diagnostics.join("; ")}` : "";
}

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const messages = error.errors.map(errorMessage).filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
