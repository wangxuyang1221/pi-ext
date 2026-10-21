import { readdir, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

export async function prepare(repo, target) {
  const source = join(repo, 'extensions/codex-ui/src');
  const output = join(target, 'codex-ui');
  await mkdir(output, { recursive: true });
  for (const file of await readdir(source)) {
    if (!file.endsWith('.ts')) continue;
    await writeFile(join(output, file.replace(/\.ts$/, '.js')), ts.transpileModule(await readFile(join(source, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
  }
  await copyFile(join(repo, 'themes/codex-pi.json'), join(target, 'codex-pi.json'));
}
