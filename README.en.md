# pi-ext

[简体中文](README.md) | English

A [Pi Coding Agent](https://github.com/earendil-works/pi) package with a Codex-style terminal interface, remote context compaction, Fast Mode, MCP connections, and inline skill mentions.

The package includes five extensions and the `codex-pi` theme. All extensions load by default. Use `pi config` to enable or disable them individually.

| Extension | What it does |
| --- | --- |
| `codex-ui` | Adds a Codex-style editor, status bar, tool previews, full thinking display, and a codemode inspector. |
| `codex-compact` | Uses Codex Remote Compaction V2 to store compressed context as encrypted checkpoints for `openai-codex` models. |
| `openai-fast-mode` | Requests the priority service tier for supported models through `/fast`. |
| `mcp` | Connects to stdio, Streamable HTTP, and legacy SSE servers and registers their tools in Pi. |
| `skill-mentions` | Completes `$skill` references in the editor, loads skills on submission, and preserves the original text for history editing. |

## Requirements

- Linux or macOS. Native Windows is not supported.
- Node.js `>=22.19.0` and pnpm `11.9.0`.
- Pi `1.5.2`. Development and peer dependencies pin this version. Other versions need separate validation.
- A terminal with 24-bit color is recommended. The default skill label icon needs a Nerd Font, with `⌘` available as an alternative.

Extensions load from compiled ESM files. Codex compaction uses Pi's existing ChatGPT authentication and does not require the Codex CLI. The UI, MCP, and skill mentions also work with other models.

## Install

Install the requirements above, then clone, build, and install the local package. The repository does not commit `dist/`, so use this source build procedure.

```bash
git clone https://github.com/wangxuyang1221/pi-ext.git
cd pi-ext
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
| Enable or disable Fast Mode | `/fast on`, `/fast off`; `/fast` toggles the state |
| Compact context manually | `/compact` |
| Check MCP connections | `/mcp status` |
| Reload MCP configuration | `/mcp reload` |
| Inspect the latest codemode call | `/inspect` |
| Reference an installed skill | Type `$`, select a skill, then submit the message |
| Change the skill label icon | `/skill-label-icon command` selects `⌘` |
| Expand tool output | `Ctrl+O` by default, following Pi's `app.tools.expand` binding |
| Copy the latest completed reply's body | Submit `/copy` in the Codex editor |

### Codex UI

`codex-ui` keeps Pi branding and adds a solid-background editor with compact tool output. The status bar shows the model, thinking level, Fast Mode, working directory, Git branch, and remaining context percentage.

- Thinking appears in its original message position under a `Thinking` heading and inside a blockquote. `Ctrl+T` keeps Pi's visibility toggle.
- Consecutive Read calls group by file, with a three-line preview per file. Bash shows the command and its first three output lines. Expand it in place to see captured output.
- Edit and Write show diffs. Tool titles use colors for running, successful, failed, and recognized cancelled or timed-out calls.
- During a task, a Working animation and elapsed time appear above the editor. The status bar shows an estimated receive rate. See the [Working and rate notes](docs/codex-working-rate.md) for how it is calculated.
- codemode shows nested calls. `/inspect` has Calls, Script, and Output tabs for child results and parent script output. After a restart, only host-persisted information can be restored. Missing details are marked explicitly.

Assistant replies use an outer list layout, while user messages retain native Markdown. Display transformations do not change stored messages or model context. `/copy` copies the reply body. Terminal selection also copies the displayed indentation, markers, and line breaks.

To reduce horizontal message padding, set `Output padding` to `0` in `/settings`. The theme controls terminal cell colors. Configure fonts, window transparency, and blur in your terminal.

The default Read and Bash tools read Pi's global settings and trusted project `.pi/settings.json`, preserving `shellCommandPrefix`, `shellPath`, and `images.autoResize`. If a settings file is invalid or unreadable, these tools refuse execution and report the problem. After fixing the file, use `/reload` or restart Pi. For SDK configuration and custom executors, see the [codex-ui entry point](extensions/codex-ui/src/index.ts).

### Skill mentions

Type `$` or a skill name prefix on any input line, for example `Use $research to check this code`. Tab or Enter selects a candidate. Once the menu closes, press Enter again to send. The extension supports both Pi's default editor and the Codex editor.

A message can reference multiple skills. Repeated references load once. Code, escaped text, unknown skills, and unreadable skills remain unchanged. Completion requires whitespace or an input boundary on both sides of the name. Submission also accepts trailing punctuation such as `$research, continue`; `$research.md` does not activate a skill.

Submitted references appear as native Pi skill cards, with a snapshot of the skill content saved for history restoration. The default label uses a Nerd Font cube icon. If the glyph is missing, run `/skill-label-icon command`. The preference is saved.

### Fast Mode

Fast Mode is off by default. When enabled, it injects `service_tier: "priority"` for every `openai-codex` model and for `openai` models in the [built-in list](extensions/openai-fast-mode/src/config.ts). The extension maintains and synchronizes that list on load.

```text
/fast on
/fast off
/fast toggle
```

In a normal root session, `pi --fast` also enables and saves the setting. Global configuration lives at `~/.pi/agent/extensions/pi-openai-fast-mode/config.json`. Project configuration lives at `.pi/pi-openai-fast-mode/config.json`.

The `fast` status means that the extension requested priority. It does not guarantee the server's tier, speed, or billing. If the server explicitly rejects Fast Mode for a Codex model, the current request fails. The extension asks you to retry and uses standard mode for that model for the rest of the session.

### Codex compaction

`codex-compact` handles only models whose provider is `openai-codex` and whose API is `openai-codex-responses`. It creates an encrypted checkpoint through the remote service and saves it as a standard Pi compaction entry. Other providers and APIs use Pi's native compaction. When you switch from a branch with a checkpoint to a non-Codex model, the extension replays the original branch.

Manual `/compact` and Pi-triggered compaction use Pi's native progress display. After the entry is saved and verified, the extension shows `Codex compaction applied`. A failed remote request or checkpoint check cancels that compaction instead of silently substituting a local text summary. The V2 path does not use the focus text in `/compact focus text` or support segmented compaction.

Global configuration lives at `~/.pi/agent/pi-codex-compact.json`. A trusted project's `.pi/pi-codex-compact.json` overrides individual global fields. For example:

```json
{
	"autoCompactTokenLimit": 180000,
	"autoCompactScope": "total",
	"effectiveContextWindowPercent": 95,
	"metadataClientVersion": "0.156.0"
}
```

| Setting | Behavior |
| --- | --- |
| `autoCompactTokenLimit` | A positive number. Defaults to 90% of the model's raw context window. Custom values are capped at the same limit. |
| `autoCompactScope` | Defaults to `total`. Also accepts `bodyAfterPrefix`. |
| `effectiveContextWindowPercent` | Defaults to `95`. Accepts values greater than 0 and at most 100. Affects the extension's window estimates, not the 90% threshold or Pi's own scheduling. |
| `metadataClientVersion` | Defaults to `0.156.0` for official Codex model catalog requests. Accepts three-part numeric versions and does not track the latest version automatically. |

On the first actual request or compaction, the extension queries and caches the official model catalog using Pi's authentication. `/codex-metadata` shows the effective version and its source. `/codex-metadata version <version>` sets the global version, and `/codex-metadata reset` removes the global override. A valid project setting still takes precedence. These commands update configuration without checking whether the server accepts the version.

If compaction starts outside a provider request and the extension cannot establish tool visibility, supply `manualProjection` explicitly. Use this example only for a normal configuration without hidden tools or a forced prompt:

```json
{
	"manualProjection": { "hiddenTools": [] }
}
```

If tools are hidden, `hiddenTools` must list their actual names. A forced prompt also requires the exact `forcedPrompt` string. When information is missing or history projection cannot be verified, the extension cancels compaction and keeps the old checkpoint. Changes to the session, model, tools, or prompt during compaction also cancel the commit.

### MCP

The MCP extension registers server tools as `mcp__<server>__<tool>`. It works without `codex-ui` and replaces Pi's built-in MCP extension. To avoid a duplicate-loading notice, add `"-builtin:mcp"` to the existing top-level `extensions` array in Pi's `settings.json`, then restart Pi.

The extension uses the first existing configuration file in this order. It does not merge files.

1. The path specified by `PI_MCP_CONFIG`.
2. A trusted project's `.pi/mcp.json`.
3. Global `~/.pi/agent/mcp.json`.

An invalid higher-priority file does not fall back to the next file. Configuration accepts JSON comments and trailing commas. This example starts a filesystem server through pnpm and grants it access to the current project directory:

```json
{
	"mcpServers": {
		"filesystem": {
			"command": "pnpm",
			"args": ["dlx", "@modelcontextprotocol/server-filesystem", "."]
		}
	}
}
```

After saving, run `/mcp reload` and `/mcp status`. Use `/mcp reconnect <server>` to reconnect manually, `/mcp logs [server]` for diagnostics, or `/mcp-init` to create configuration in a trusted project.

Timeout values are in milliseconds. Connections can recover automatically, but tool calls are not replayed by default. Historical tools can display offline, and restoring history does not execute them again. Text results are limited to 50 KiB and 2,000 lines. Truncated content is not saved as a separate full log. See the [MCP guide](extensions/mcp/README.md) for remote server configuration, retry policies, and diagnostics.

## Compatibility

The default environment uses stock Pi `1.5.2`. Optional patches add two capabilities:

- [Text region refresh](docs/pi-text-region-refresh.md) lets dynamic regions such as Working reuse existing layout.
- [Session summary projection](docs/pi-session-summary-patch.md) shows the user's task text for skill messages in the resume list and search.

Patches use a separate dependency tree and an explicit launcher. They do not modify global Pi. Stock Pi retains the main functionality of all five extensions, but uses ordinary rendering. Skill sessions may show protocol envelopes in the resume list, and searches may match saved skill content. Installing this package does not install host patches. See [Pi compatibility](docs/pi152-compatibility.md) for the full scope and verification commands.

Do not load this package alongside standalone `npm:@yeungkc/pi-codex-compact@0.0.6` or `npm:pi-openai-fast-mode` installations. They would register duplicate commands or hooks. When migrating, verify this package, disable the old entries, and restart Pi.

## Development

Edit `src/` and the corresponding tests. The build generates `dist/`. After making changes, run:

```bash
pnpm run check
```

This command checks documentation links, script paths, secrets, builds, types, offline tests, package contents, and host loading of source and compiled entries. Default tests isolate user configuration and credentials and do not send paid model requests.

Run focused tests through the repository entry point too:

```bash
pnpm test extensions/mcp/__tests__/index.test.ts
```

Terminal changes also need the relevant CLI or PTY acceptance checks. The separate `pnpm run pi152:live` command incurs real service usage and is not part of the default checks. See [Testing](docs/testing.md) for test groups, prerequisites, and cleanup rules.

| Path | Purpose |
| --- | --- |
| `extensions/<name>/src/` | Extension source. |
| `extensions/<name>/__tests__/` | Tests, fixtures, and user journeys. |
| `extensions/<name>/dist/` | Generated runtime files, not committed. |
| `themes/` | The `codex-pi` theme. |
| `scripts/`, `test-support/` | Build and verification scripts, shared test support, and isolated host environments. |
| `.cursor/skills/` | Project verification skills. |
| `docs/` | Testing, compatibility, and maintenance notes. |

`codex-search` is maintained and checked separately in the repository. It is not included in the current release package or automatic loading list.

Run `pnpm pack --pack-destination .scratch/release` to create a release package. `prepack` rebuilds all five extensions. The package contains compiled files, the theme, both READMEs, licenses, and attribution files. Tests and logs are excluded.

## License and attribution

Local code uses the [MIT license](LICENSE). Bundled components also contain Apache-2.0, MPL-2.0, and Unicode-3.0 licensed material. Package metadata declares `(MIT AND Apache-2.0 AND MPL-2.0 AND Unicode-3.0)`.

Codex Compact is based on `@yeungkc/pi-codex-compact` 0.0.6. Fast Mode is based on `pi-openai-fast-mode` 0.3.0. Imported versions, upstream sources, and local changes are recorded in the [Codex Compact attribution](extensions/codex-compact/UPSTREAM.md) and [Fast Mode attribution](extensions/openai-fast-mode/UPSTREAM.md).
