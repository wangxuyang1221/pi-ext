import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2]);
const sdkRoot = resolve(process.argv[3]);
const repo = process.cwd();
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const paths = {};
const versions = {};
for (const name of ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"]) {
  const packageRoot = resolve(sdkRoot, "..", name);
  paths[`@earendil-works/${name}`] = [join(packageRoot, "dist/index.d.ts")];
  versions[name] = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
}
await mkdir(root, { recursive: true });
const outputs = {};
for (const entry of manifest.pi.extensions) {
  const extension = entry.split("/")[2];
  const configPath = join(root, `${extension}.json`);
  const output = join(root, "extensions", extension, "dist");
  await writeFile(configPath, JSON.stringify({ extends: join(repo, "extensions", extension, "tsconfig.json"), compilerOptions: { outDir: output, paths } }, null, 2));
  const result = spawnSync("pnpm", ["exec", "tsc", "-p", configPath, "--listFiles"], { encoding: "utf8" });
  await writeFile(join(root, `${extension}.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `${extension} failed against pinned declarations`);
  assert.ok(result.stdout.includes(join(sdkRoot, "dist/index.d.ts")), "Pinned SDK declaration was not read");
  const walk = async (directory, prefix = "") => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = join(prefix, item.name);
      if (item.isDirectory()) await walk(join(directory, item.name), relative);
      else if (relative.endsWith(".js")) {
        const generated = await readFile(join(output, relative));
        const published = await readFile(join(repo, "extensions", extension, "dist", relative));
        assert.deepEqual(generated, published, `Version build differs: ${extension}/${relative}`);
        outputs[`extensions/${extension}/dist/${relative}`] = createHash("sha256").update(generated).digest("hex");
      }
    }
  };
  await walk(output);
}
await writeFile(join(root, "results.json"), JSON.stringify({ passed: true, versions, outputs, byteIdenticalJavaScript: true }, null, 2));
console.log(`Built seven extensions against Pi ${versions["pi-coding-agent"]}; JavaScript matches the release build`);
