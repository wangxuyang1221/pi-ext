import { createTestEnvironment } from "../test-support/environment.mjs";
import { inspectPiHost } from "./pi-host.mjs";
import { runTestProcess } from "./test-process.mjs";
import { pnpmCommand } from "./pnpm-command.mjs";

const args = process.argv.slice(2);
const suiteIndex = args.indexOf("--suite");
const suite = suiteIndex < 0 ? "offline" : args.splice(suiteIndex, 2)[1];
if (suite !== "offline") throw new Error("Choose --suite offline");
const customConfig = args.some(arg => arg === "--config" || arg === "-c" || arg.startsWith("--config="));
if (!customConfig) args.unshift("--project", suite);
console.log(JSON.stringify({ check: "vitest", ...inspectPiHost() }));
if (!process.env.npm_execpath) throw new Error("Run tests through pnpm run test");
const { directory: root, env } = createTestEnvironment("pi-tests");
const [command, ...commandArgs] = pnpmCommand(["exec", "vitest", "run", ...args]);
process.exitCode = await runTestProcess(command, commandArgs, {
    directory: root,
    env
  });
