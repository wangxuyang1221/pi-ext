import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
    const blockingMarkerFile = join(root, "integration-block-ready");
    const extensionFile = join(root, "integration-extension.mjs");
    const subagentExtensionUrl = pathToFileURL(
      resolve("extensions/subagent/dist/index.js"),
    ).href;
    await writeFile(extensionFile, `
import { writeFile } from "node:fs/promises";

import subagentExtension from ${JSON.stringify(subagentExtensionUrl)};
import { Type } from "typebox";

const blockingMarkerFile = ${JSON.stringify(blockingMarkerFile)};

export default function integrationExtension(pi) {
  subagentExtension(pi);
  pi.registerTool({
    name: "integration_block",
    label: "Integration block",
    description: "Block long enough to verify prompt delivery while the child is streaming.",
    parameters: Type.Object({ marker: Type.String() }),
    async execute(_toolCallId, params) {
      await writeFile(blockingMarkerFile, params.marker, "utf8");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));
      return {
        content: [{ type: "text", text: params.marker }],
        details: {},
      };
    },
  });
  pi.registerTool({
    name: "integration_large_output",
    label: "Integration large output",
    description: "Return a large deterministic payload for the subagent integration test.",
    parameters: Type.Object({ marker: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{
          type: "text",
          text: params.marker + ":" + "x".repeat(1024 * 1024),
        }],
        details: {},
      };
    },
  });
}
`, "utf8");
    const manager = new SubagentManager({
      store,
      runtime,
      stateRoot: root,
      nativeSessionRoot: join(root, "native-sessions"),
      extensionPath: extensionFile,
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
    const blockingToolMarker = `SUBAGENT_E2E_BLOCK_${Date.now()}`;
    const markerFour = `SUBAGENT_E2E_FOUR_${Date.now()}`;
    const largeResultMarker = `SUBAGENT_E2E_LARGE_RESULT_${Date.now()}`;
    const markerFive = `SUBAGENT_E2E_FIVE_${Date.now()}`;
    const model = process.env.PI_PROVIDER && process.env.PI_MODEL
      ? { provider: process.env.PI_PROVIDER, id: process.env.PI_MODEL }
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

      const idleDelivery = await manager.prompt(
        parentId,
        spawned.agentId,
        `Reply with exactly ${markerTwo}. Do not call tools.`,
        "steer",
      );
      assert.equal(idleDelivery.confirmation, "session");
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
      assert.ok(second.activityCursor);

      const blockingDelivery = await manager.prompt(
        parentId,
        spawned.agentId,
        `Call integration_block exactly once with marker ${blockingToolMarker}. After it succeeds, reply with exactly ${markerFour}.`,
        "steer",
      );
      assert.equal(blockingDelivery.confirmation, "session");
      await waitForPath(blockingMarkerFile, 30_000);
      const queuedDelivery = await manager.prompt(
        parentId,
        spawned.agentId,
        `Reply with exactly ${markerThree}. Do not call tools.`,
        "follow_up",
      );
      assert.equal(queuedDelivery.confirmation, "follow_up_queue");

      let streamingSettled = await manager.wait(parentId, spawned.agentId, {
        afterSettled: second.settledCursor!,
        timeoutMs: 120_000,
        afterActivity: second.activityCursor,
        assistantLimit: 3,
        toolLimit: 3,
      });
      assert.equal(streamingSettled.outcome, "settled");
      const streamingActivity = [...streamingSettled.activity];
      for (let attempt = 0; attempt < 2 && !streamingActivity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerThree),
      ); attempt += 1) {
        const next = await manager.wait(parentId, spawned.agentId, {
          afterSettled: streamingSettled.settledCursor!,
          timeoutMs: 120_000,
          afterActivity: streamingSettled.activityCursor,
          assistantLimit: 3,
          toolLimit: 3,
        });
        assert.equal(next.outcome, "settled");
        streamingSettled = next;
        streamingActivity.push(...next.activity);
      }
      assert.ok(streamingActivity.some(
        (activity) => (
          activity.kind === "tool"
          && activity.toolName === "integration_block"
          && activity.outcome === "succeeded"
        ),
      ));
      assert.ok(streamingActivity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerFour),
      ));
      assert.ok(streamingActivity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerThree),
      ));
      assert.ok(streamingSettled.activityCursor);

      const largeDelivery = await manager.prompt(
        parentId,
        spawned.agentId,
        `Call integration_large_output exactly once with marker ${largeResultMarker}. After it succeeds, reply with exactly ${markerFive}.`,
        "steer",
      );
      assert.equal(largeDelivery.confirmation, "session");
      const largeSettled = await manager.wait(parentId, spawned.agentId, {
        afterSettled: streamingSettled.settledCursor!,
        timeoutMs: 120_000,
        afterActivity: streamingSettled.activityCursor,
        assistantLimit: 1,
        toolLimit: 1,
      });
      assert.equal(largeSettled.outcome, "settled");
      assert.equal(largeSettled.generation, streamingSettled.generation + 1);
      assert.ok(largeSettled.activity.some(
        (activity) => (
          activity.kind === "tool"
          && activity.toolName === "integration_large_output"
          && activity.outcome === "succeeded"
        ),
      ));
      assert.ok(largeSettled.activity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerFive),
      ));
      const serializedLargeSettled = JSON.stringify(largeSettled);
      assert.equal(serializedLargeSettled.includes(largeResultMarker), false);
      assert.equal(
        largeSettled.returnedBytes,
        Buffer.byteLength(serializedLargeSettled, "utf8"),
      );
      assert.ok(largeSettled.returnedBytes <= 72 * 1024);

      const largeRead = await manager.read(parentId, spawned.agentId, {
        view: "recent_activity",
        after: streamingSettled.activityCursor,
        assistantLimit: 1,
        toolLimit: 1,
      });
      assert.equal(largeRead.view, "recent_activity");
      const serializedLargeRead = JSON.stringify(largeRead);
      assert.equal(serializedLargeRead.includes(largeResultMarker), false);
      assert.ok(Buffer.byteLength(serializedLargeRead, "utf8") <= 72 * 1024);
      assert.equal(
        largeRead.returnedBytes,
        Buffer.byteLength(serializedLargeRead, "utf8"),
      );
      const largeTool = largeRead.activity.find((activity) => (
        activity.kind === "tool" && activity.toolName === "integration_large_output"
      ));
      assert.ok(largeTool);
      assert.equal(largeTool.outcome, "succeeded");
      assert.ok(largeRead.activity.some(
        (activity) => activity.kind === "assistant" && activity.text.includes(markerFive),
      ));

      const detail = await manager.read(parentId, spawned.agentId, {
        view: "activity_detail",
        activityId: largeTool.id,
        section: "tool_result",
      });
      assert.equal(detail.view, "activity_detail");
      assert.equal(detail.originalBytes, largeResultMarker.length + 1 + 1024 * 1024);
      assert.equal(detail.returnedBytes, 16 * 1024);
      assert.ok(detail.content.startsWith(`${largeResultMarker}:`));
      assert.equal(detail.hasMore, true);
      assert.ok(detail.nextDetailCursor);

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
  360_000,
);

async function waitForPath(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await access(path);
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for integration path: ${path}`);
      }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
}
