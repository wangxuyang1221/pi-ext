import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { completionReference } from "./references.js";

/** Layer skill-name completion over the host provider without replacing its other triggers. */
export function skillAutocomplete(current: AutocompleteProvider, commands: () => SlashCommandInfo[]): AutocompleteProvider {
  return {
    triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "$"])],
    async getSuggestions(lines, row, col, options) {
      const offset = lines.slice(0, row).reduce((total, line) => total + line.length + 1, 0) + col;
      const reference = completionReference(lines.join("\n"), offset);
      if (!reference) return current.getSuggestions(lines, row, col, options);
      const items = commands().filter(command => command.source === "skill" && command.name.startsWith("skill:"))
        .map(command => ({ value: `$${command.name.slice(6)}`, label: command.name.slice(6), description: command.description }))
        .filter(item => item.value.slice(1).startsWith(reference.name));
      return items.length ? { prefix: `$${reference.name}`, items } : null;
    },
    applyCompletion(lines, row, col, item, prefix) {
      if (!prefix.startsWith("$") || !item.value.startsWith("$")) return current.applyCompletion(lines, row, col, item, prefix);
      const result = [...lines];
      result[row] = lines[row].slice(0, col - prefix.length) + item.value + lines[row].slice(col);
      return { lines: result, cursorLine: row, cursorCol: col - prefix.length + item.value.length };
    },
    shouldTriggerFileCompletion: (...args) => current.shouldTriggerFileCompletion?.(...args) ?? true,
  };
}
