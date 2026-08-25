# pi-ext

Two extensions for [Pi Coding Agent](https://github.com/earendil-works/pi):

- `mcp` connects Pi to Model Context Protocol servers and exposes their tools as `mcp__<server>__<tool>`.
- `permissions` adds `Default permissions` and `Full access` modes with per-call approval controls.

## Requirements

- Node.js 22.19 or newer
- `@earendil-works/pi-coding-agent` 0.84.3 or a compatible release

The repository is tested on Linux, macOS, and Windows. Runtime entry points are compiled ESM files under each extension's `dist/` directory. Pi never needs to transpile the TypeScript source during startup.

## Install

Install both extensions from GitHub:

```bash
pi install git:github.com/wangxuyang1221/pi-ext
```

Restart Pi after installation. Use `pi config` to disable either extension without removing the package.

To test the package without saving it to settings:

```bash
pi -e git:github.com/wangxuyang1221/pi-ext
```

Pi packages execute with your user account's full system permissions. Review the source before installing it.

## MCP extension

Create a project config at `.pi/mcp.json` or a global config at `~/.pi/agent/mcp.json`:

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "timeout": 30000
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer replace-me"
      }
    }
  }
}
```

JSON comments and trailing commas are accepted. Supported transports are `stdio`, `http`, `streamable-http`, and legacy `sse`.

Commands:

```text
/mcp status
/mcp reload
/mcp-init
```

`/mcp-init` creates `.pi/mcp.json`. Do not commit credentials stored in MCP headers or environment variables.

## Permissions extension

The extension starts in `Full access` unless `PI_PERMISSIONS_MODE=default` is set.

```text
/permissions
/permissions default
/permissions full
```

In `Default permissions`:

- `read`, `grep`, `find`, `ls`, and subagent orchestration tools run without prompts.
- Mutating tools, shell commands, and MCP tools require approval.
- `Allow this session` grants are process-local, operation-scoped, bounded to 512 entries, and discarded when Pi exits.
- Non-interactive modes fail closed when approval is required.

Switching back to `Full access` requires an interactive confirmation.

## Development

```bash
npm ci --ignore-scripts
npm run check
```

Useful commands:

```bash
npm run typecheck
npm test
npm run build
npm run package:check
npm pack --dry-run
```

The repository commits `dist/` intentionally. Pi installs Git packages with production dependencies only, so Git installs load these prebuilt files without requiring TypeScript. CI rejects stale generated files. The `prepack` lifecycle rebuilds both extensions before creating an npm tarball, which contains only compiled runtime files, declarations, source maps, the license, and this README.

## Layout

```text
extensions/
  mcp/
    src/
    __tests__/
    dist/
  permissions/
    src/
    __tests__/
    dist/
scripts/
```

## License

MIT
