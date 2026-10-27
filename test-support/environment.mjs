import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";

const allowed = new Set([
  "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "TERM", "COLORTERM", "CI", "FORCE_COLOR", "NO_COLOR", "NPM_EXECPATH",
  "PI_SUBAGENT_ISOLATED_INTEGRATION", "PI_SUBAGENT_FIXTURE_DIST", "PI_SUBAGENT_BENCHMARK",
  "PI_SUBAGENT_TEST_CLI", "PI_SUBAGENT_TEST_FISH", "PI_FAST_EVIDENCE", "PI_SUBAGENT_TRACE_DIR",
  "PI_MCP_TEST_PI_ROOT", "PI_MCP_TEST_PI_VERSION", "PI_CODEX_TEST_PI_ROOT", "PI_GOAL_TEST_ENTRY",
]);

export function createTestEnvironment(prefix) {
  mkdirSync(resolve(".tmp"), { recursive: true });
  const directory = mkdtempSync(resolve(`.tmp/${prefix}-`));
  for (const name of ["home", "agent", "tmp", "cache", "config", "data", "state"]) mkdirSync(join(directory, name));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  return { directory, env: {
    ...inherited, HOME: join(directory, "home"), USERPROFILE: join(directory, "home"),
    APPDATA: join(directory, "config"), LOCALAPPDATA: join(directory, "cache"), PI_CODING_AGENT_DIR: join(directory, "agent"),
    TMPDIR: join(directory, "tmp"), TMP: join(directory, "tmp"), TEMP: join(directory, "tmp"),
    XDG_CACHE_HOME: join(directory, "cache"), XDG_CONFIG_HOME: join(directory, "config"),
    XDG_DATA_HOME: join(directory, "data"), XDG_STATE_HOME: join(directory, "state"),
    // Dependencies are installed before testing. A different HOME must not trigger pnpm to reinstall them.
    pnpm_config_verify_deps_before_run: "false",
    PI_OFFLINE: "1", PI_TELEMETRY: "0", PYTHONDONTWRITEBYTECODE: "1", PI_TEST_ISOLATED: "1",
  } };
}
