import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { inspectPiHost } from "./pi-host.mjs";
import { runTestProcess } from "./test-process.mjs";

console.log(JSON.stringify({ check: "vitest", ...inspectPiHost() }));
if (!process.env.npm_execpath) throw new Error("Run tests through pnpm run test");
mkdirSync(resolve(".tmp"), { recursive: true });
const root = mkdtempSync(resolve(".tmp/pi-tests-"));
for (const name of ["home", "agent", "tmp", "cache", "config", "data", "state"]) mkdirSync(join(root, name));
// Keep only execution prerequisites and explicit offline acceptance controls.
const allowed = new Set([
  "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "TERM", "COLORTERM", "CI", "FORCE_COLOR", "NO_COLOR", "NPM_EXECPATH",
  "PI_SUBAGENT_ISOLATED_INTEGRATION", "PI_SUBAGENT_FIXTURE_DIST", "PI_SUBAGENT_BENCHMARK",
  "PI_SUBAGENT_TEST_CLI", "PI_SUBAGENT_TEST_FISH", "PI_FAST_EVIDENCE", "PI_SUBAGENT_TRACE_DIR",
  "PI_MCP_TEST_PI_ROOT", "PI_MCP_TEST_PI_VERSION", "PI_CODEX_TEST_PI_ROOT", "PI_GOAL_TEST_ENTRY",
]);
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
process.exitCode = await runTestProcess(process.execPath,
  [process.env.npm_execpath, "exec", "vitest", "run", ...process.argv.slice(2)], {
    directory: root,
    env: { ...environment, HOME: join(root, "home"), USERPROFILE: join(root, "home"),
      APPDATA: join(root, "config"), LOCALAPPDATA: join(root, "cache"), PI_CODING_AGENT_DIR: join(root, "agent"),
      TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
      XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), PI_OFFLINE: "1", PI_TELEMETRY: "0" }
  });
