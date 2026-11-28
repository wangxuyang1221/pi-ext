# pi-theme

[简体中文](README.md) | English

Two independently installable terminal UI plugins for [Pi Coding Agent](https://github.com/earendil-works/pi). Each plugin ships its own layout and palette.

## Requirements

- Linux or macOS. Native Windows is not supported.
- Node.js `>=22.19.0` and pnpm `11.9.0`.
- Pi `1.7.0`. Development and peer dependencies pin this version. Other versions need separate validation.
- A terminal with 24-bit color is recommended.

## Install

Build the workspace, then install one UI plugin. Both plugins own the editor, footer and tool renderers, so enable one per Pi session.

```bash
git clone https://github.com/wangxuyang1221/pi-theme.git
cd pi-theme
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

| Plugin | Theme | Install from the repository root |
| --- | --- | --- |
| Codex UI | `codex-pi` | `pi install "$PWD/extensions/codex-ui"` |
| Claude Code UI | `claude-code` | `pi install "$PWD/extensions/claude-code-ui"` |

Restart Pi to use the selected interface. Pi keeps a reference to the installed directory. After pulling changes, rebuild the selected plugin with `pnpm run build:codex-ui` or `pnpm run build:claude-code-ui` and restart Pi.

To switch plugins, use `pi list` to find the installed source, remove it with `pi remove <source>`, then install the other plugin and restart Pi. The theme picker changes colors within the loaded interface.

## Everyday use

| Action | Command or input |
| --- | --- |
| Inspect the latest codemode call | `/inspect` |
| Expand tool output | `Ctrl+O` by default, following Pi's `app.tools.expand` binding |
| Copy the latest completed reply's body | Submit `/copy` in the editor |

### Claude Code UI

The `claude-code-ui` plugin provides a Claude Code 2.x terminal layout with a dark palette for translucent terminals.

- **Welcome card**: two-column terracotta rounded box with the pixel-block Clawd mascot, real Pi shortcuts, model/thinking status, working directory, and Git branch; collapses cleanly to one column below 78 columns.
- **Composer and `!` bash mode**: transparent double-hairline composer with a `❯ ` prompt; typing `!` switches the hairlines, prompt, and footer hint to bash-mode pink in real time.
- **Working indicator and footer**: terracotta spinner with a left-to-right shimmer verb and `(esc to interrupt · elapsed · ↓ N tokens)` above the editor (following Pi's `app.interrupt` binding, `esc` by default); footer pairs Pi's `app.thinking.cycle` (`Shift+Tab` by default) thinking indicator (`⏵⏵ thinking: <level>`) and `app.interrupt` bash-cancel hint on the left with model, Git branch, remaining context percentage, and live receive rate on the right.
- **Messages and tools**: user messages start with `❯ `, assistant prose starts with `● `, thinking renders under `∴ Thinking…` in muted italic (following Pi's `app.thinking.toggle` binding when collapsed, `∴ Thinking… (ctrl+t to expand)` by default), and tools render as `● Read(path)` / `● Read N files`, `● Bash(cmd)`, `● Update(path)` (`Added X lines, removed Y lines` + diff), `● Write(path)` (`Wrote N lines to ...`), and `Search`/`Glob`/`List` with `  ⎿  ` connectors.

### Codex UI

`codex-ui` keeps Pi branding and adds a solid-background editor with compact tool output. The status bar shows the model, thinking level, working directory, Git branch, and remaining context percentage.

- Thinking appears in its original message position under a standalone `Thinking` blockquote heading, with each body block rendered in a muted per-block blockquote rail so thinking stays visually distinct while preserving top-level streaming and syntax-highlight caches. `Ctrl+T` and clicks in mouse-enabled fullscreen mode keep Pi's visibility toggle.
- Consecutive Read calls group by file, one row per file when collapsed and numbered content when expanded. Bash shows the command with the first and last two output lines, and puts failure, timeout or interrupt status in the title. Expand it in place to see captured output; truncated captures show the saved output path or why full output could not be saved below the preview.
- Edit and Write show diffs. Tool titles use colors for running, successful, failed, and recognized cancelled or timed-out calls.
- During a task, a Working animation and elapsed time appear above the editor. The status bar shows an estimated receive rate. See the [Working and rate notes](docs/codex-working-rate.md) for how it is calculated.
- codemode shows nested calls. `/inspect` has Calls, Script, and Output tabs for child results and parent script output. After a restart, only host-persisted information can be restored. Missing details are marked explicitly.

Both assistant replies and user messages retain native top-level Markdown layout without an outer list wrapper. Display transformations do not change stored messages or model context. `/copy` copies the reply body; terminal selection copies the rendered native layout and line breaks.

Messages and self-rendered tools (Read, Bash, Edit, Write, and codemode) all follow Pi's `Output padding` setting (default `1`) for aligned horizontal margins; set `Output padding` to `0` in `/settings` to render flush with the terminal edges. The theme controls terminal cell colors. Configure fonts, window transparency, and blur in your terminal.

The default Read and Bash tools read Pi's global settings and trusted project `.pi/settings.json`, preserving `shellCommandPrefix`, `shellPath`, and `images.autoResize`. If a settings file is invalid or unreadable, these tools refuse execution and report the problem. After fixing the file, use `/reload` or restart Pi. For SDK configuration and custom executors, see the [codex-ui entry point](extensions/codex-ui/src/index.ts).

## Upgrading

If you previously installed the repository root with `pi install "$PWD"`, run `pi remove "$PWD"` from that same checkout. Build and install your preferred plugin from the table above and restart Pi. To keep the Claude layout, choose `claude-code-ui`.

Rebuild and restart Pi when upgrading from the multi-extension package. If you previously added `"-builtin:mcp"` to the `extensions` setting, remove that entry to enable Pi’s built-in MCP. Use the previous version for sessions that require a retired extension.

## Development

Run `pnpm run check` to build, type-check, run offline tests, load the extension in Pi, and verify the package manifest. See the [testing guide](docs/testing.md) for terminal acceptance and commit hooks.

## License

[MIT](LICENSE).
