import { createTestEnvironment } from "../test-support/environment.mjs";
import { inspectPiHost } from "./pi-host.mjs";
import { runTestProcess } from "./test-process.mjs";
import { pnpmCommand } from "./pnpm-command.mjs";

const args = process.argv.slice(2);
const suiteIndex = args.indexOf("--suite");
const suite = suiteIndex < 0 ? "offline" : args.splice(suiteIndex, 2)[1];
if (!["offline", "host"].includes(suite)) throw new Error("Choose --suite offline or --suite host");
if (suite === "host" && process.platform === "win32") throw new Error("Host tests require Unix, tmux and fish");
const customConfig = args.some(arg => arg === "--config" || arg === "-c" || arg.startsWith("--config="));
if (!customConfig) args.unshift("--project", suite);
if (suite === "host") args.unshift("--no-file-parallelism");
console.log(JSON.stringify({ check: "vitest", ...inspectPiHost() }));
if (!process.env.npm_execpath) throw new Error("Run tests through pnpm run test");
const { directory: root, env } = createTestEnvironment("pi-tests");
const [command, ...commandArgs] = pnpmCommand(["exec", "vitest", "run", ...args]);
process.exitCode = await runTestProcess(command, commandArgs, {
    directory: root,
    env: { ...env, ...(suite === "host" ? { PI_SUBAGENT_ISOLATED_INTEGRATION: "1" } : {}) }
  });
