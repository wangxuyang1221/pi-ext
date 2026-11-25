# pi-theme

[简体中文](README.md) | English

A Codex-style terminal interface and the `codex-pi` theme for [Pi Coding Agent](https://github.com/earendil-works/pi).

## Requirements

- Linux or macOS. Native Windows is not supported.
- Node.js `>=22.19.0` and pnpm `11.9.0`.
- Pi `1.6.0`. Development and peer dependencies pin this version. Other versions need separate validation.
- A terminal with 24-bit color is recommended.

## Install

Install the requirements above, then clone, build, and install the local package. The repository does not commit `dist/`, so use this source build procedure.

```bash
git clone https://github.com/wangxuyang1221/pi-theme.git
cd pi-theme
pnpm install --frozen-lockfile --ignore-scripts
pnpm run hooks:install
pnpm run hooks:check
pnpm run build
pi install "$PWD"
```

`pi install` saves a reference to the local directory in your user settings. It does not copy the files. Keep the directory after installation and restart Pi.

To select the theme for this run:

```bash
pi --use-theme codex-pi
```

To save the theme as your default, select `codex-pi` in `/settings`. The choice persists across `/new`, `/resume`, `/fork`, and `/reload`.

To load the package for one run without saving installation settings, run this from the built repository root:

```bash
pi -e "$PWD"
```

After updating the source, install the locked dependencies again, rebuild, and restart Pi. Do not rely on `/reload` alone for code upgrades.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

## Everyday use

| Action | Command or input |
| --- | --- |
| Inspect the latest codemode call | `/inspect` |
| Expand tool output | `Ctrl+O` by default, following Pi's `app.tools.expand` binding |
| Copy the latest completed reply's body | Submit `/copy` in the Codex editor |

### Codex UI

`codex-ui` keeps Pi branding and adds a solid-background editor with compact tool output. The status bar shows the model, thinking level, working directory, Git branch, and remaining context percentage.

- Thinking appears in its original message position under a standalone `Thinking` blockquote heading, while the body retains native italic thinking styling and top-level block layout. `Ctrl+T` and clicks in mouse-enabled fullscreen mode keep Pi's visibility toggle.
- Consecutive Read calls group by file, one row per file when collapsed and numbered content when expanded. Bash shows the command with the first and last two output lines, and puts failure, timeout or interrupt status in the title. Expand it in place to see captured output.
- Edit and Write show diffs. Tool titles use colors for running, successful, failed, and recognized cancelled or timed-out calls.
- During a task, a Working animation and elapsed time appear above the editor. The status bar shows an estimated receive rate. See the [Working and rate notes](docs/codex-working-rate.md) for how it is calculated.
- codemode shows nested calls. `/inspect` has Calls, Script, and Output tabs for child results and parent script output. After a restart, only host-persisted information can be restored. Missing details are marked explicitly.

Both assistant replies and user messages retain native top-level Markdown layout without an outer list wrapper. Display transformations do not change stored messages or model context. `/copy` copies the reply body; terminal selection copies the rendered native layout and line breaks.

To reduce horizontal message padding, set `Output padding` to `0` in `/settings`. The theme controls terminal cell colors. Configure fonts, window transparency, and blur in your terminal.

The default Read and Bash tools read Pi's global settings and trusted project `.pi/settings.json`, preserving `shellCommandPrefix`, `shellPath`, and `images.autoResize`. If a settings file is invalid or unreadable, these tools refuse execution and report the problem. After fixing the file, use `/reload` or restart Pi. For SDK configuration and custom executors, see the [codex-ui entry point](extensions/codex-ui/src/index.ts).

## Upgrading

Rebuild and restart Pi when upgrading from the multi-extension package. If you previously added `"-builtin:mcp"` to the `extensions` setting, remove that entry to enable Pi’s built-in MCP. Use the previous version for sessions that require a retired extension.

## Development

Run `pnpm run check` to build, type-check, run offline tests, load the extension in Pi, and verify the package manifest. See the [testing guide](docs/testing.md) for terminal acceptance and commit hooks.

## License

[MIT](LICENSE).
