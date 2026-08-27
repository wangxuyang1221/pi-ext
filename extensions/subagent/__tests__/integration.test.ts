import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "vitest";

import { SubagentManager } from "../src/manager.js";
import { SessionStateStore, createSessionState } from "../src/state-store.js";
import {
  TmuxRuntime,
  type CommandExecution,
} from "../src/tmux-runtime.js";

const runIntegration = process.env.PI_SUBAGENT_INTEGRATION === "1";

test.skipIf(!runIntegration)(
  "runs the full managed lifecycle against real Pi and tmux",
  async () => {
    const root = await mkdtemp(join(process.cwd(), ".subagent-integration-test-"));
    const store = new SessionStateStore(root);
    const tmuxSessionName = `pi-subagent-test-${process.pid}-${Date.now()}`;
    const piPath = process.env.PI_SUBAGENT_PI_PATH
      ?? "/Users/wangxuyang/Library/pnpm/bin/pi";
    const tmuxPath = process.env.PI_SUBAGENT_TMUX_PATH
      ?? "/opt/homebrew/bin/tmux";
    const execute: CommandExecution = (command, args, options) => new Promise((resolveResult) => {
      execFile(command, args, {
        cwd: options?.cwd,
        signal: options?.signal,
        timeout: options?.timeout,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number"
          ? (error as NodeJS.ErrnoException & { code: number }).code
          : error
            ? 1
            : 0;
        resolveResult({ code, stdout, stderr });
      });
    });
    const runtime = new TmuxRuntime({
      execute,
      tmuxPath,
      sessionName: tmuxSessionName,
      transferDirectory: join(root, "prompt-transfer"),
    });
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: resolve("extensions/subagent/dist/index.js"),
      piPath,
      environment: Object.fromEntries(Object.entries({
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SHELL: process.env.SHELL,
        TERM: process.env.TERM ?? "xterm-256color",
        LANG: process.env.LANG,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      registrationTimeoutMs: 20_000,
      closeTimeoutMs: 10_000,
    });
    const parentSessionFile = join(root, "parent.jsonl");
    const parentId = "integration-parent";
    const markerOne = `SUBAGENT_E2E_ONE_${Date.now()}`;
    const markerTwo = `SUBAGENT_E2E_TWO_${Date.now()}`;
    const markerThree = `SUBAGENT_E2E_THREE_${Date.now()}`;
    const model = process.env.PI_PROVIDER && process.env.PI_MODEL
      ? `${process.env.PI_PROVIDER}/${process.env.PI_MODEL}`
      : undefined;

    try {
      await writeFile(parentSessionFile, `${JSON.stringify({
        type: "session",
        version: 3,
        id: parentId,
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n`, "utf8");
      await store.save(createSessionState({
        sessionId: parentId,
        epoch: "integration-parent-epoch",
        cwd: process.cwd(),
        sessionFile: parentSessionFile,
        now: new Date().toISOString(),
      }));

      const spawned = await manager.spawn(parentId, {
        task: `Reply with exactly ${markerOne}. Do not call tools.`,
        name: "Integration child",
        ...(model ? { model } : {}),
        thinkingLevel: "minimal",
      }, {
        cwd: process.cwd(),
        model,
        thinkingLevel: "minimal",
      });
      const first = await manager.wait(parentId, spawned.agentId, {
        afterSettled: spawned.settledCursor,
        timeoutMs: 120_000,
        assistantLimit: 3,
        toolLimit: 3,
      });
      assert.equal(first.outcome, "settled");
      assert.ok(first.activity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerOne),
      ));
      const read = await manager.read(parentId, spawned.agentId, {
        view: "recent_activity",
        assistantLimit: 3,
        toolLimit: 3,
      });
      assert.equal(read.view, "recent_activity");
      assert.ok(read.activity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerOne),
      ));

      await manager.prompt(
        parentId,
        spawned.agentId,
        `Reply with exactly ${markerTwo}. Do not call tools.`,
        "steer",
      );
      await manager.prompt(
        parentId,
        spawned.agentId,
        `Reply with exactly ${markerThree}. Do not call tools.`,
        "follow_up",
      );
      const second = await manager.wait(parentId, spawned.agentId, {
        afterSettled: first.settledCursor!,
        timeoutMs: 120_000,
        afterActivity: first.activityCursor,
        assistantLimit: 3,
        toolLimit: 3,
      });
      assert.equal(second.outcome, "settled");
      assert.equal(second.generation, first.generation + 1);
      assert.ok(second.activity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerTwo),
      ));
      assert.ok(second.activity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerThree),
      ));

      const nativeSessionFile = spawned.sessionFile;
      const affected = await manager.close(parentId, spawned.agentId);
      assert.deepEqual(affected.map((agent) => agent.agentId), [spawned.agentId]);
      assert.equal(await store.load(spawned.agentId), undefined);
      assert.deepEqual((await store.load(parentId))?.children, []);
      assert.deepEqual((await manager.list(parentId)).capacity, {
        active: 0,
        pending: 0,
        limit: 3,
        available: 3,
      });
      await access(nativeSessionFile);
    } finally {
      await execute(tmuxPath, ["kill-session", "-t", `=${tmuxSessionName}`]);
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);
