import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import {
  TmuxRuntime,
  type CommandExecution,
} from "../src/tmux-runtime.js";

const locator = {
  sessionName: "pi-subagents-test",
  windowId: "@7",
  paneId: "%9",
  panePid: 1234,
};

test("rejects prompt injection when the registered pane is not ready", async () => {
  for (const output of [
    "pi-subagents-test\t@7\t%9\t2\t0\t1234\t0\n",
    "pi-subagents-test\t@7\t%9\t1\t0\t1234\t1\n",
  ]) {
    const calls: string[][] = [];
    const execute: CommandExecution = async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: output, stderr: "" };
    };
    const runtime = new TmuxRuntime({
      execute,
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: locator.sessionName,
      transferDirectory: "/unused",
    });

    await assert.rejects(
      runtime.sendPrompt(locator, "Do not inject this", "steer"),
      /not ready for prompt delivery/u,
    );
    assert.deepEqual(calls, [[
      "display-message",
      "-p",
      "-t",
      "%9",
      "#{session_name}\t#{window_id}\t#{pane_id}\t#{window_panes}\t#{pane_dead}\t#{pane_pid}\t#{pane_in_mode}",
    ]]);
  }
});

test("delivers follow-up prompts with raw clear and submit bytes", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-tmux-test-"));
  const calls: Array<{ command: string; args: string[] }> = [];
  const sleeps: number[] = [];
  const prompt = "Review 'quoted' input\nthen run: $(touch never)";
  let transferred = "";
  let transferMode = 0;
  const execute: CommandExecution = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === "display-message") {
      return {
        code: 0,
        stdout: "pi-subagents-test\t@7\t%9\t1\t0\t1234\t0\n",
        stderr: "",
      };
    }
    if (args[0] === "load-buffer") {
      const path = args.at(-1);
      assert.ok(path);
      transferred = await readFile(path, "utf8");
      transferMode = (await stat(path)).mode & 0o777;
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  try {
    const runtime = new TmuxRuntime({
      execute,
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: locator.sessionName,
      transferDirectory: root,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    await runtime.sendPrompt(locator, prompt, "follow_up");

    assert.equal(transferred, `${prompt} `);
    assert.equal(transferMode, 0o600);
    assert.equal(calls.some((call) => call.args.includes(prompt)), false);
    assert.deepEqual(calls.map((call) => call.args[0]), [
      "display-message",
      "load-buffer",
      "send-keys",
      "paste-buffer",
      "send-keys",
      "delete-buffer",
    ]);
    assert.deepEqual(calls[2].args, ["send-keys", "-H", "-t", "%9", "03"]);
    assert.deepEqual(calls[3].args.slice(0, 8), [
      "paste-buffer",
      "-b",
      calls[1].args[2],
      "-t",
      "%9",
      "-p",
      "-r",
      "-d",
    ]);
    assert.deepEqual(calls[4].args, ["send-keys", "-H", "-t", "%9", "1b", "0d"]);
    assert.deepEqual(sleeps, [100, 100]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps automatic clears for one pane at least 600ms apart", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-tmux-test-"));
  const clearTimes: number[] = [];
  const submitCalls: string[][] = [];
  const sleeps: number[] = [];
  let now = 0;
  const execute: CommandExecution = async (_command, args) => {
    if (args[0] === "display-message") {
      return {
        code: 0,
        stdout: "pi-subagents-test\t@7\t%9\t1\t0\t1234\t0\n",
        stderr: "",
      };
    }
    if (args[0] === "send-keys" && args.at(-1) === "03") clearTimes.push(now);
    if (args[0] === "send-keys" && args.at(-1) === "0d") submitCalls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };

  try {
    const runtime = new TmuxRuntime({
      execute,
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: locator.sessionName,
      transferDirectory: root,
      nowMs: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });

    await runtime.sendPrompt(locator, "First", "steer");
    await runtime.sendPrompt(locator, "Second", "steer");

    assert.deepEqual(clearTimes, [0, 600]);
    assert.deepEqual(submitCalls, [
      ["send-keys", "-H", "-t", "%9", "0d"],
      ["send-keys", "-H", "-t", "%9", "0d"],
    ]);
    assert.deepEqual(sleeps, [100, 100, 400, 100, 100]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launches a child with quoted argv and parses its tmux locator", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-tmux-test-"));
  const calls: Array<{ command: string; args: string[] }> = [];
  const execute: CommandExecution = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === "has-session") return { code: 1, stdout: "", stderr: "missing" };
    return {
      code: 0,
      stdout: "pi-subagents-test\t@7\t%9\t1234\n",
      stderr: "",
    };
  };

  try {
    const runtime = new TmuxRuntime({
      execute,
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "pi-subagents-test",
      transferDirectory: root,
    });

    const result = await runtime.launch({
      cwd: "/repo with spaces",
      windowName: "Lin; safe",
      command: "/path/pi",
      args: ["--session-dir", "/tmp/a'b"],
      environment: {
        PATH: "/custom/bin",
        PI_SUBAGENT_TOKEN: "token'quoted",
      },
    });

    assert.deepEqual(result, locator);
    assert.deepEqual(calls[0].args, ["has-session", "-t", "=pi-subagents-test"]);
    const launchArgs = calls[1].args;
    assert.deepEqual(launchArgs.slice(0, 11), [
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}",
      "-s",
      "pi-subagents-test",
      "-n",
      "Lin; safe",
      "-c",
      "/repo with spaces",
    ]);
    assert.equal(
      launchArgs[11],
      "exec /usr/bin/env 'PATH=/custom/bin' 'PI_SUBAGENT_TOKEN=token'\"'\"'quoted' '/path/pi' '--session-dir' '/tmp/a'\"'\"'b'",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers when another spawn creates the tmux session concurrently", async () => {
  const calls: string[][] = [];
  let hasSessionChecks = 0;
  const execute: CommandExecution = async (_command, args) => {
    calls.push(args);
    if (args[0] === "has-session") {
      hasSessionChecks += 1;
      return hasSessionChecks === 1
        ? { code: 1, stdout: "", stderr: "missing" }
        : { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "new-session") {
      return { code: 1, stdout: "", stderr: "duplicate session" };
    }
    return {
      code: 0,
      stdout: "pi-subagents-test\t@7\t%9\t1234\n",
      stderr: "",
    };
  };
  const runtime = new TmuxRuntime({
    execute,
    tmuxPath: "/opt/homebrew/bin/tmux",
    sessionName: "pi-subagents-test",
    transferDirectory: "/unused",
  });

  const result = await runtime.launch({
    cwd: "/repo",
    windowName: "Concurrent",
    command: "/path/pi",
    args: [],
    environment: {},
  });

  assert.deepEqual(result, locator);
  assert.deepEqual(calls.map((args) => args[0]), [
    "has-session",
    "new-session",
    "has-session",
    "new-window",
  ]);
});

test("locates the current child pane for self-registration", async () => {
  const execute: CommandExecution = async (_command, args) => {
    assert.deepEqual(args, [
      "display-message",
      "-p",
      "-t",
      "%9",
      "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}\t#{window_name}",
    ]);
    return {
      code: 0,
      stdout: "pi-subagents-test\t@7\t%9\t1234\tLin\n",
      stderr: "",
    };
  };
  const runtime = new TmuxRuntime({
    execute,
    tmuxPath: "/opt/homebrew/bin/tmux",
    sessionName: "pi-subagents-test",
    transferDirectory: "/unused",
  });

  assert.deepEqual(await runtime.locatePane("%9"), { ...locator, windowName: "Lin" });
});

test("captures the registered pane as joined plain text", async () => {
  const execute: CommandExecution = async (_command, args) => {
    assert.deepEqual(args, ["capture-pane", "-p", "-J", "-t", "%9"]);
    return {
      code: 0,
      stdout: "Follow-up: [subagent:123456789abc]\n",
      stderr: "",
    };
  };
  const runtime = new TmuxRuntime({
    execute,
    tmuxPath: "/opt/homebrew/bin/tmux",
    sessionName: locator.sessionName,
    transferDirectory: "/unused",
  });

  assert.equal(
    await runtime.capturePane(locator),
    "Follow-up: [subagent:123456789abc]\n",
  );
});

test("does not report unknown tmux query failures as a dead runtime", async () => {
  const calls: string[][] = [];
  let stderr = "error connecting to /isolated/socket (Permission denied)";
  const runtime = new TmuxRuntime({
    execute: async (_command, args) => { calls.push(args); return { code: 1, stdout: "", stderr }; },
    tmuxPath: "unused", sessionName: locator.sessionName, transferDirectory: "/unused",
  });
  await assert.rejects(runtime.isAlive(locator), /tmux display-message failed/u);
  await assert.rejects(runtime.close(locator), /tmux display-message failed/u);
  assert.equal(calls.some((args) => args[0] === "kill-window"), false);
  stderr = "can't find pane: %9";
  assert.equal(await runtime.isAlive(locator), false);
  stderr = "no server running on /isolated/socket";
  assert.equal(await runtime.isAlive(locator), false);
});

test("validates locator identity before treating or closing a pane", async () => {
  const calls: string[][] = [];
  let identity = "pi-subagents-test\t@7\t%9\t0\t1234\n";
  const execute: CommandExecution = async (_command, args) => {
    calls.push(args);
    if (args[0] === "display-message") {
      return { code: 0, stdout: identity, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const runtime = new TmuxRuntime({
    execute,
    tmuxPath: "/opt/homebrew/bin/tmux",
    sessionName: "pi-subagents-test",
    transferDirectory: "/unused",
  });

  assert.equal(await runtime.isAlive(locator), true);
  await runtime.close(locator);

  identity = "pi-subagents-test\t@8\t%9\t0\t1234\n";
  assert.equal(await runtime.isAlive(locator), false);
  await runtime.close(locator);

  assert.deepEqual(calls.filter((args) => args[0] === "kill-window"), [
    ["kill-window", "-t", "@7"],
  ]);
  assert.equal(calls.at(-1)?.[0], "display-message");
});
