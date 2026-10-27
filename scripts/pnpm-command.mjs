// pnpm may be a JavaScript entry point or a standalone native executable.
export function pnpmCommand(args, entry = process.env.npm_execpath) {
  if (!entry) throw new Error("Run this command through pnpm");
  return /\.(?:[cm]?js)$/i.test(entry)
    ? [process.execPath, entry, ...args]
    : [entry, ...args];
}
