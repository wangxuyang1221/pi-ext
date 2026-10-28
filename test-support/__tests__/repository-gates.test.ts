import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { scanSecrets } from "../../scripts/secret-scan.mjs";
import { readSnapshot } from "../../scripts/repository-snapshot.mjs";

const scripts = fileURLToPath(new URL("../../scripts/", import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "commit-gates-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  git("init", "-q");
  git("config", "user.name", "Gate Test");
  git("config", "user.email", "gate@example.invalid");
  write("package.json", JSON.stringify({ scripts: {} }));
  git("add", "package.json");
  return {
    root, git, write,
    run: (script: string, ...args: string[]) => spawnSync(process.execPath, [join(scripts, script), ...args], {
      cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    }),
    [Symbol.dispose]() { rmSync(root, { recursive: true, force: true }); },
  };
}

test("rejects a staged script reference whose target is only in the worktree", () => {
  using repo = fixture();
  repo.write("package.json", JSON.stringify({ scripts: { example: "node scripts/missing.mjs" } }));
  repo.git("add", "package.json");
  repo.write("scripts/missing.mjs", "export {};\n");
  repo.write("package.json", JSON.stringify({ scripts: {} }));
  const before = repo.git("diff", "--binary");
  const result = repo.run("check-repository.mjs", "--staged");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("scripts/missing.mjs");
  expect(repo.git("diff", "--binary")).toBe(before);
});

const fakeToken = () => ["ghp", "Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4"].join("_");

test("rejects secrets from the index even after the worktree is repaired and never prints the value", () => {
  using repo = fixture();
  const token = fakeToken();
  repo.write(".env.example", `GITHUB_TOKEN=${token}\n`);
  repo.git("add", ".env.example");
  repo.write(".env.example", "GITHUB_TOKEN=\n");
  const index = repo.git("ls-files", "--stage", "-z");
  const result = repo.run("check-commit.mjs");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("secretlint-rule-github");
  expect(result.stderr).not.toContain(token);
  expect(result.stdout).not.toContain(token);
  expect(repo.git("ls-files", "--stage", "-z")).toBe(index);
  expect(readFileSync(join(repo.root, ".env.example"), "utf8")).toBe("GITHUB_TOKEN=\n");
});

test("does not inspect unstaged secrets or follow symbolic links outside the snapshot", () => {
  using repo = fixture();
  repo.write("safe.ts", "export {};\n");
  symlinkSync("local.ts", join(repo.root, "reference.ts"));
  repo.git("add", "safe.ts", "reference.ts");
  repo.write("safe.ts", fakeToken());
  repo.write("local.ts", fakeToken());
  expect(repo.run("check-commit.mjs").status).toBe(0);
});

test.each([".env", "nested/.env.local", "dist/output.js", "logs/run.log"])("rejects forced local artifacts: %s", path => {
  using repo = fixture();
  repo.write(path, "local configuration\n");
  repo.git("add", "-f", path);
  const result = repo.run("check-commit.mjs");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("local configuration or generated artifact");
});

test("uses staged ignore rules even when the worktree permits the file", () => {
  using repo = fixture();
  repo.write(".gitignore", "private-config.json\n");
  repo.write("private-config.json", "{}\n");
  repo.git("add", "-f", ".gitignore", "private-config.json");
  repo.write(".gitignore", "");
  expect(repo.run("check-commit.mjs").status).toBe(1);
});

test("rejects conflict markers and whitespace without changing the index", () => {
  using repo = fixture();
  repo.write("broken.txt", "<".repeat(7) + " HEAD\nleft\n" + "=".repeat(7) + "\nright\n" + ">".repeat(7) + " branch\n");
  repo.git("add", "broken.txt");
  expect(repo.run("check-commit.mjs").stderr).toContain("unresolved conflict marker");
  repo.write("broken.txt", "trailing space \n");
  repo.git("add", "broken.txt");
  expect(repo.run("check-commit.mjs").stderr).toContain("whitespace errors");
});

test("handles renames, deletions, Unicode and newline paths on the first commit", () => {
  using repo = fixture();
  repo.write("空 格\nfile.ts", "export {};\n");
  repo.git("add", ".");
  expect(repo.run("check-commit.mjs").status).toBe(0);
  repo.git("commit", "-qm", "fixture");
  repo.git("mv", "空 格\nfile.ts", "renamed.ts");
  expect(repo.run("check-commit.mjs").status).toBe(0);
  repo.git("rm", "-f", "renamed.ts");
  expect(repo.run("check-commit.mjs").status).toBe(0);
});

test("scans unchanged index files so amend cannot preserve a missed secret", () => {
  using repo = fixture();
  repo.write("secret.txt", fakeToken());
  repo.git("add", ".");
  repo.git("commit", "-qm", "fixture before hooks");
  expect(repo.run("check-commit.mjs").status).toBe(1);
});

test("requires exact exceptions and does not honor inline disable comments", async () => {
  const content = Buffer.from(`// secretlint-disable\n${fakeToken()}\n`);
  const files = new Map([["fixture.txt", { mode: "100644", content }]]);
  const findings = await scanSecrets(files);
  expect(findings.length).toBeGreaterThan(0);
  const first = findings[0]!;
  files.set("config/secret-exceptions.json", { mode: "100644", content: Buffer.from(JSON.stringify([
    { path: first.path, ruleId: first.ruleId, messageId: first.messageId, sha256: first.sha256, reason: "Synthetic token" },
  ])) });
  expect(await scanSecrets(files)).toEqual([]);
  files.set("another.txt", { mode: "100644", content });
  expect((await scanSecrets(files)).some(finding => finding.path === "another.txt")).toBe(true);
  files.set("fixture.txt", { mode: "100644", content: Buffer.from(fakeToken().replace("Ab3", "Zb3")) });
  expect((await scanSecrets(files)).some(finding => finding.path === "fixture.txt")).toBe(true);
});

test.each([
  ["privatekey", () => generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()],
  ["openai", () => "sk-" + "Ab3C".repeat(5) + "T3BlbkFJ" + "De4F".repeat(5)],
  ["database-connection-string", () => ["postgresql://app:", "synthetic-password", "@db.invalid/app"].join("")],
] as const)("detects %s credentials in examples and binary payloads", async (rule, secret) => {
  const files = new Map([["examples/fixture.dat", { mode: "100644", content: Buffer.concat([
    Buffer.from([0, 255]), Buffer.from(secret()),
  ]) }]]);
  const findings = await scanSecrets(files);
  expect(findings.some(finding => finding.ruleId === `@secretlint/secretlint-rule-${rule}`)).toBe(true);
});

test("fails closed on invalid exception configuration", () => {
  using repo = fixture();
  repo.write("config/secret-exceptions.json", "not json");
  repo.git("add", ".");
  const result = repo.run("check-commit.mjs");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Secret scanner failed");
});

test("detects an index change after taking the snapshot", () => {
  using repo = fixture();
  const snapshot = readSnapshot(repo.root, true);
  repo.write("added.txt", "new index entry\n");
  repo.git("add", "added.txt");
  expect(() => snapshot.assertUnchanged()).toThrow("Index changed");
});

test("rejects unmerged entries and gitlinks instead of silently skipping them", () => {
  using repo = fixture();
  repo.git("commit", "-qm", "fixture");
  const oid = repo.git("rev-parse", "HEAD:package.json").trim();
  execFileSync("git", ["update-index", "--index-info"], { cwd: repo.root,
    input: `100644 ${oid} 1\tconflicted.txt\n100644 ${oid} 2\tconflicted.txt\n100644 ${oid} 3\tconflicted.txt\n` });
  expect(repo.run("check-commit.mjs").stderr).toContain("Unmerged index entries");
  repo.git("update-index", "--force-remove", "conflicted.txt");
  repo.git("update-index", "--add", "--cacheinfo", `160000,${repo.git("rev-parse", "HEAD").trim()},nested-repository`);
  expect(repo.run("check-commit.mjs").stderr).toContain("Unsupported index entry");
});

test("CI base comparison detects committed whitespace that an empty staged diff would miss", () => {
  using repo = fixture();
  repo.git("commit", "-qm", "base");
  const base = repo.git("rev-parse", "HEAD").trim();
  repo.write("bad.txt", "trailing whitespace \n");
  repo.git("add", "bad.txt");
  repo.git("commit", "-qm", "fixture without hook");
  expect(repo.run("check-commit.mjs", "--base", base).status).toBe(1);
});

test("history scan detects a deleted secret including paths with newlines", () => {
  using repo = fixture();
  repo.write("past\nsecret.txt", fakeToken());
  repo.git("add", ".");
  repo.git("commit", "-qm", "historical fixture");
  repo.git("rm", "past\nsecret.txt");
  repo.git("commit", "-qm", "removed fixture");
  expect(repo.run("check-secrets.mjs").status).toBe(0);
  const result = repo.run("check-secrets.mjs", "--history");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Historical blob");
  expect(result.stderr).toContain("secretlint-rule-github");
  expect(result.stderr).not.toContain(fakeToken());
});

function installFixture(repo: ReturnType<typeof fixture>) {
  for (const name of ["hooks.mjs", "repository-snapshot.mjs", "repository-ignores.mjs", "check-repository.mjs", "check-commit.mjs", "secret-scan.mjs"]) {
    repo.write(`scripts/${name}`, readFileSync(join(scripts, name), "utf8"));
  }
  repo.write(".githooks/pre-commit", readFileSync(join(scripts, "../.githooks/pre-commit"), "utf8"));
  chmodSync(join(repo.root, ".githooks/pre-commit"), 0o755);
  repo.write("package.json", JSON.stringify({ scripts: { "check:staged": "node scripts/check-commit.mjs" } }));
  repo.write(".gitignore", "node_modules\n");
  symlinkSync(join(scripts, "../node_modules"), join(repo.root, "node_modules"), "dir");
  repo.git("add", ".");
  expect(repo.run("hooks.mjs", "install").status).toBe(0);
}

test("installs idempotently and rejects a real git commit without losing staged or unstaged edits", () => {
  using repo = fixture();
  expect(repo.run("hooks.mjs", "check").status).toBe(1);
  installFixture(repo);
  expect(repo.run("hooks.mjs", "install").status).toBe(0);
  expect(repo.run("hooks.mjs", "check").status).toBe(0);
  repo.git("commit", "-qm", "fixture");
  const head = repo.git("rev-parse", "HEAD");
  repo.write("leak.txt", fakeToken());
  repo.git("add", "leak.txt");
  repo.write("leak.txt", "worktree repair\n");
  const before = repo.git("ls-files", "--stage", "-z");
  const result = spawnSync("git", ["commit", "-m", "must fail"], { cwd: repo.root, encoding: "utf8" });
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("secretlint-rule-github");
  expect(result.stdout + result.stderr).not.toContain(fakeToken());
  expect(repo.git("rev-parse", "HEAD")).toBe(head);
  expect(repo.git("ls-files", "--stage", "-z")).toBe(before);
  expect(readFileSync(join(repo.root, "leak.txt"), "utf8")).toBe("worktree repair\n");
  repo.git("add", "leak.txt");
  repo.git("commit", "-qm", "repaired fixture");
  expect(repo.git("rev-parse", "HEAD")).not.toBe(head);
});

test("does not overwrite custom hook configuration or hide existing executable hooks", () => {
  using repo = fixture();
  repo.write(".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
  chmodSync(join(repo.root, ".githooks/pre-commit"), 0o755);
  repo.git("config", "core.hooksPath", "custom-hooks");
  expect(repo.run("hooks.mjs", "install").status).toBe(1);
  expect(repo.git("config", "--get", "core.hooksPath").trim()).toBe("custom-hooks");
  repo.git("config", "--unset", "core.hooksPath");
  repo.write(".git/hooks/post-commit", "#!/bin/sh\nexit 0\n");
  chmodSync(join(repo.root, ".git/hooks/post-commit"), 0o755);
  expect(repo.run("hooks.mjs", "install").status).toBe(1);
  rmSync(join(repo.root, ".git/hooks/post-commit"));
  chmodSync(join(repo.root, ".githooks/pre-commit"), 0o644);
  expect(repo.run("hooks.mjs", "install").status).toBe(1);
});

test("uses the linked worktree hook and its own index", () => {
  using repo = fixture();
  installFixture(repo);
  repo.git("commit", "-qm", "fixture");
  const linked = join(repo.root, "linked");
  repo.git("worktree", "add", "--detach", linked, "HEAD");
  symlinkSync(join(scripts, "../node_modules"), join(linked, "node_modules"), "dir");
  const run = (...args: string[]) => spawnSync(process.execPath, [join(scripts, "hooks.mjs"), ...args], { cwd: linked, encoding: "utf8" });
  expect(run("check").status).toBe(0);
  writeFileSync(join(linked, "secret.txt"), fakeToken());
  execFileSync("git", ["add", "secret.txt"], { cwd: linked });
  const result = spawnSync("git", ["commit", "-m", "must fail"], { cwd: linked, encoding: "utf8" });
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("secretlint-rule-github");
  expect(repo.git("status", "--porcelain", "--untracked-files=no")).toBe("");
});

test.each(["failure", "cancelled", "skipped", "missing"])("rejects a CI job with result %s", status => {
  const needs: Record<string, { result: string }> = {
    test: { result: "success" }, "unix-host": { result: "success" }, "python-and-skills": { result: "success" },
  };
  if (status === "missing") delete needs["unix-host"];
  else needs["unix-host"] = { result: status };
  const result = spawnSync(process.execPath, [join(scripts, "check-ci.mjs")], {
    encoding: "utf8", env: { ...process.env, CI_JOB_RESULTS: JSON.stringify(needs) },
  });
  expect(result.status).toBe(1);
});

test("accepts CI only when every required job succeeds", () => {
  const results = Object.fromEntries(["test", "unix-host", "python-and-skills"].map(name => [name, { result: "success" }]));
  const result = spawnSync(process.execPath, [join(scripts, "check-ci.mjs")], {
    encoding: "utf8", env: { ...process.env, CI_JOB_RESULTS: JSON.stringify(results) },
  });
  expect(result.status).toBe(0);
});

test("checks staged links and preserves partial changes after success", () => {
  using repo = fixture();
  repo.write("README.md", "[Target](docs/target.md)\n");
  repo.write("docs/target.md", "# Target\n");
  repo.git("add", ".");
  repo.write("README.md", "[Unstaged](missing.md)\n");
  const before = repo.git("diff", "--binary");
  expect(repo.run("check-repository.mjs", "--staged").status).toBe(0);
  expect(repo.git("diff", "--binary")).toBe(before);
  repo.git("rm", "-f", "docs/target.md");
  expect(repo.run("check-repository.mjs", "--staged").status).toBe(1);
});
