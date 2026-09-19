import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { executeCommand } from "../src/command-executor.js";
import { withOperation } from "../src/operation.js";

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

test("an unreachable socket does not prove that a live server lost its terminal resources", async () => {
  const runtime = new TmuxRuntime({
    execute: async () => ({ code: 1, stdout: "", stderr: "no server running on /missing-socket" }),
    tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: "/unused",
  });
  const observed = await runtime.observe({ ...locator, serverPid: process.pid, serverStartedAt: "old", socketPath: "/missing-socket", processInstanceId: "owned" });
  assert.equal(observed.terminal, "unknown");
  await assert.rejects(runtime.close({ ...locator, serverPid: process.pid, serverStartedAt: "old", socketPath: "/missing-socket", processInstanceId: "owned" }));
});

test("launch command discards stale server configuration while preserving the new pane identity", async () => {
  let command = "";
  const runtime = new TmuxRuntime({
    execute: async (_command, args) => {
      if (args[0] === "has-session") return { code: 1, stdout: "", stderr: "missing" };
      command = args.at(-1)!;
      return { code: 0, stdout: "pi-subagents-test\t@7\t%9\t1234\n", stderr: "" };
    }, tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: "/unused",
  });
  await runtime.launch({ cwd: process.cwd(), windowName: "test", command: process.execPath,
    args: ["-e", "console.log(JSON.stringify({stale:process.env.PI_CODING_AGENT_DIR,pane:process.env.TMUX_PANE}))"], environment: {} });
  const result = await executeCommand("/usr/bin/env", ["PI_CODING_AGENT_DIR=/stale/server", "TMUX_PANE=%new", "/bin/sh", "-c", command]);
  assert.deepEqual(JSON.parse(result.stdout), { pane: "%new" });
});

test("follows a renamed and moved pane only with matching server and instance evidence", async () => {
  const tagged = { ...locator, serverPid: 900, serverStartedAt: "1000", socketPath: "/socket", processInstanceId: "instance-a" };
  const runtime = new TmuxRuntime({
    execute: async () => ({ code: 0, stdout: "renamed\t@99\t%9\t0\t1234\t900\t1000\t/socket\tinstance-a\t1\t0\n", stderr: "" }),
    tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: "/unused",
  });
  const observed = await runtime.observe(tagged);
  assert.equal(observed.identity, "matched");
  assert.equal(observed.process, "alive");
  assert.equal(observed.locator?.windowId, "@99");
  assert.equal(observed.promptReady, true);
});

test("cleans up an owned dead pane instead of treating process exit as terminal removal", async () => {
  const calls: string[][] = [];
  const runtime = new TmuxRuntime({
    execute: async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: "pi-subagents-test\t@7\t%9\t1\t1234\n", stderr: "" };
    },
    tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: "/unused",
  });
  await runtime.close(locator);
  assert.equal(calls.filter((args) => args[0] === "kill-window").length, 1);
});

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

test("cancellation removes a possibly loaded buffer before the operation returns", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-tmux-test-"));
  const controller = new AbortController();
  const calls: string[][] = [];
  let transfer = "";
  const runtime = new TmuxRuntime({
    tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: root,
    execute: async (_command, args, options) => {
      calls.push(args);
      if (args[0] === "display-message") return { code: 0, stdout: "pi-subagents-test\t@7\t%9\t1\t0\t1234\t0\n", stderr: "" };
      if (args[0] === "load-buffer") {
        transfer = args.at(-1)!;
        controller.abort(new Error("Cancelled after buffer creation"));
        throw controller.signal.reason;
      }
      assert.equal(options?.signal?.aborted, false);
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  try {
    await assert.rejects(withOperation(1_000, controller.signal, () => runtime.sendPrompt(locator, "Task", "follow_up")), /Cancelled after buffer creation/u);
    assert.equal(calls.filter(args => args[0] === "delete-buffer").length, 1);
    await assert.rejects(stat(transfer), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports buffer cleanup failure alongside prompt cancellation", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-tmux-test-"));
  const controller = new AbortController();
  const original = new Error("Original cancellation");
  const runtime = new TmuxRuntime({
    tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: root,
    execute: async (_command, args) => {
      if (args[0] === "display-message") return { code: 0, stdout: "pi-subagents-test\t@7\t%9\t1\t0\t1234\t0\n", stderr: "" };
      if (args[0] === "load-buffer") { controller.abort(original); throw original; }
      throw new Error("Buffer cleanup failed");
    },
  });
  try {
    await assert.rejects(withOperation(1_000, controller.signal, () => runtime.sendPrompt(locator, "Task", "follow_up")), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, original);
      assert.match(String(error), /cleanup/u);
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
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
    assert.deepEqual(launchArgs.slice(11), [
      "/bin/sh", "-c",
      "exec /usr/bin/env -i TMUX=\"${TMUX-}\" TMUX_PANE=\"${TMUX_PANE-}\" 'PATH=/custom/bin' 'PI_SUBAGENT_TOKEN=token'\"'\"'quoted' '/path/pi' '--session-dir' '/tmp/a'\"'\"'b'",
    ]);
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
  for (const args of [calls[1], calls[3]]) assert.deepEqual(args.slice(-3, -1), ["/bin/sh", "-c"]);
});

test.each(["wrong-marker", "changed-server", "changed-pid"])("identity installation rejects %s instead of waiting or accepting a replacement", async (kind) => {
  let identityReads = 0;
  const runtime = new TmuxRuntime({ tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: "/unused",
    execute: async (_command, args) => {
      if (args.at(-1)?.endsWith("#{window_name}")) return { code: 0, stdout: "pi-subagents-test\t@7\t%9\t1234\tChild\n", stderr: "" };
      identityReads++;
      const marker = kind === "wrong-marker" ? "other-instance" : identityReads === 1 ? "" : "instance";
      const serverPid = kind === "changed-server" && identityReads > 1 ? 901 : 900;
      const panePid = kind === "changed-pid" && identityReads > 1 ? 5678 : 1234;
      return { code: 0, stdout: `${serverPid}\t1000\t/socket\t${marker}\t1\t0\t%9\t${panePid}\n`, stderr: "" };
    } });
  await assert.rejects(runtime.locatePane("%9", "instance", { timeout: 1000 }), /identity handshake/u);
  assert.equal(identityReads, kind === "wrong-marker" ? 1 : 2);
});

test.each(["deadline", "abort"])("pending identity installation stops every query on %s", async (kind) => {
  const controller = new AbortController();
  let identityReads = 0;
  const budgets: number[] = [];
  const runtime = new TmuxRuntime({ tmuxPath: "tmux", sessionName: locator.sessionName, transferDirectory: "/unused",
    execute: async (_command, args, options) => {
      budgets.push(options!.timeout!);
      if (args.at(-1)?.endsWith("#{window_name}")) return { code: 0, stdout: "pi-subagents-test\t@7\t%9\t1234\tChild\n", stderr: "" };
      identityReads++;
      if (kind === "abort") controller.abort(new Error("Cancelled identity lookup"));
      return { code: 0, stdout: "900\t1000\t/socket\t\t1\t0\t%9\t1234\n", stderr: "" };
    } });
  const started = performance.now();
  await assert.rejects(runtime.locatePane("%9", "instance", { timeout: 50, signal: controller.signal }), /timed out|Cancelled identity lookup/u);
  assert.ok(performance.now() - started < 1000);
  assert.ok(budgets.length > 0 && budgets.every(budget => budget <= 50));
  const finalReads = identityReads;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(identityReads, finalReads);
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

test("does not classify a renamed live pane as an exited process", async () => {
  const calls: string[][] = [];
  const runtime = new TmuxRuntime({
    execute: async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: "renamed\t@7\t%9\t0\t1234\n", stderr: "" };
    },
    tmuxPath: "unused", sessionName: locator.sessionName, transferDirectory: "/unused",
  });
  await assert.rejects(runtime.isAlive(locator), /identity.*mismatch/iu);
  await assert.rejects(runtime.close(locator), /identity.*mismatch/iu);
  assert.equal(calls.some(args => args[0] === "kill-window"), false);
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
  await assert.rejects(runtime.isAlive(locator), /identity mismatch/u);
  await assert.rejects(runtime.close(locator), /identity mismatch/u);

  assert.deepEqual(calls.filter((args) => args[0] === "kill-window"), [
    ["kill-window", "-t", "@7"],
  ]);
  assert.equal(calls.at(-1)?.[0], "display-message");
});
