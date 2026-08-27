// PROTOTYPE: dependency-free TypeScript dev server for the throwaway TUI study.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ts", "text/javascript; charset=utf-8"],
]);

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url ?? "/", "http://localhost").pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = normalize(join(root, requested));
  return resolved.startsWith(root) ? resolved : null;
}

const server = createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    const resolvedPath = fileStat.isDirectory() ? join(filePath, "index.html") : filePath;
    const extension = extname(resolvedPath);
    const source = await readFile(resolvedPath, "utf8");
    const body =
      extension === ".ts"
        ? ts.transpileModule(source, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ES2022,
              strict: true,
            },
            fileName: resolvedPath,
          }).outputText
        : source;

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes.get(extension) ?? "text/plain; charset=utf-8",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log([
    `Pi TUI profile prototype: http://127.0.0.1:${port}/?variant=codex`,
    `Pi Bash block prototype: http://127.0.0.1:${port}/bash.html?variant=a`,
  ].join("\n"));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
