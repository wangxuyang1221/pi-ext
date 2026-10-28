import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, repositoryRoot } from "./repository-snapshot.mjs";

try {
  const command = process.argv[2];
  if (!["install", "check"].includes(command) || process.argv.length !== 3) throw new Error("Usage: hooks.mjs <install|check>");
  const root = repositoryRoot();
  const hook = join(root, ".githooks/pre-commit");
  accessSync(hook, constants.X_OK);
  if (realpathSync(hook) !== hook) throw new Error("The repository hook must be a regular file inside .githooks.");
  const config = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
  if (![0, 1].includes(config.status)) throw new Error("Cannot read Git hook configuration.");
  const current = config.status === 0 ? config.stdout.trim() : undefined;
  if (current !== undefined && current !== ".githooks") throw new Error("An existing core.hooksPath is configured. Integrate it explicitly before installing repository hooks.");
  if (command === "install") {
    if (current === undefined) {
      const directory = resolve(root, git(root, ["rev-parse", "--git-path", "hooks"]).trim());
      for (const name of existsSync(directory) ? readdirSync(directory) : []) {
        if (name.endsWith(".sample")) continue;
        try { accessSync(join(directory, name), constants.X_OK); }
        catch { continue; }
        throw new Error("Existing executable Git hooks would be hidden. Integrate them before installing repository hooks.");
      }
    }
    git(root, ["config", "--local", "core.hooksPath", ".githooks"]);
  } else if (current !== ".githooks") throw new Error("Repository hooks are not installed. Run pnpm run hooks:install.");
  const effective = git(root, ["rev-parse", "--git-path", "hooks/pre-commit"]).trim();
  if (resolve(root, effective) !== hook) throw new Error("Git is not using this worktree's pre-commit hook.");
  console.log(`Repository pre-commit hook ${command === "install" ? "installed" : "verified"}.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
