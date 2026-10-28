import ignore from "ignore";

export function snapshotIgnores(files) {
  const matchers = new Map();
  for (const [path, entry] of files) {
    if (entry.mode !== "120000" && (path === ".gitignore" || path.endsWith("/.gitignore"))) {
      matchers.set(path.slice(0, -".gitignore".length), ignore({ ignorecase: false }).add(entry.content.toString("utf8")));
    }
  }
  return path => {
    const segments = path.split("/");
    const active = [];
    let prefix = "";
    for (let depth = 0; depth < segments.length; depth++) {
      if (matchers.has(prefix)) active.push({ prefix, matcher: matchers.get(prefix) });
      const target = segments.slice(0, depth + 1).join("/") + (depth < segments.length - 1 ? "/" : "");
      let ignored = false;
      for (const { prefix: base, matcher } of active) {
        const result = matcher.test(target.slice(base.length));
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
      }
      // Git cannot re-include files below an excluded parent directory.
      if (ignored) return true;
      prefix += segments[depth] + "/";
    }
    return false;
  };
}
