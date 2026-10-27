export function hasSuccessfulPaneExit(pane: string, procStat?: string): boolean {
  if (pane.trim() === "1\t0") return true;
  if (pane.trim() !== "1" || !procStat) return false;
  // /proc/<pid>/stat fields 3 (state) and 52 (wait status). The command
  // name can contain spaces and parentheses, so split after its final ')'.
  const end = procStat.lastIndexOf(")");
  if (end < 0) return false;
  const fields = procStat.slice(end + 1).trim().split(/\s+/u);
  return fields[0] === "Z" && fields[49] === "0";
}
