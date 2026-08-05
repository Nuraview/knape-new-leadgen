# NuraView MCP server

`@nuraview/mcp` is a local stdio MCP server for NuraView.

It runs over stdio, signs in with NuraView's device flow, and then calls the NuraView API with a bearer token. The package lives in `packages/mcp` in this monorepo and exposes the `nuraview-mcp` CLI.

> **Tip:** Every NuraView instance also ships a built-in HTTP MCP endpoint at `/api/mcp`. If your MCP client supports Streamable HTTP transport (e.g. Claude Code), you can connect directly without this package. See the [MCP docs](https://docs.nuraview.app/core/integrations/mcp) for details.

## Prerequisites

- Node.js 20+
- A running NuraView API (for example `http://localhost:1337`) and web app (for device approval UI).

NuraView allows `nuraview-cli` and `nuraview-mcp` by default, so you usually do not need extra server configuration.

If you want to run this server with a different client ID, allow it on the NuraView server:

```bash
DEVICE_AUTH_CLIENT_IDS=nuraview-cli,nuraview-mcp,your-client-id
```

## Environment

| Variable | Description |
|----------|-------------|
| `NURAVIEW_API_URL` | NuraView API origin (default `http://localhost:1337`). Do not include `/api`. |
| `NURAVIEW_MCP_CLIENT_ID` | Device-flow client id (default `nuraview-mcp`). Must match `DEVICE_AUTH_CLIENT_IDS` on the server. |
| `NURAVIEW_API_KEY` | **Optional.** A NuraView API key (create one under Settings → Account → Developer). When set, the server authenticates with it as a Bearer token and skips the interactive device flow — use this for headless/Docker setups. |

## Install

**Recommended (no global install):** run the interactive installer with npx:

```bash
npx @nuraview/mcp
```

npm downloads the package, then an **interactive menu** (arrow keys + Enter) asks **where** to register the server (Cursor user-wide, Cursor project, Claude Desktop, or a custom JSON path). It then merges a `mcpServers` entry that points at this package’s `dist/index.js` with your current Node binary.

In a normal terminal, `npx @nuraview/mcp` and `nuraview-mcp` with no subcommand both start the installer. When the process is **not** attached to a TTY (for example when Cursor launches the MCP server with a pipe), the same entry runs the stdio MCP server instead.

To run the server manually from a shell (for example to debug stdio), use:

```bash
npx @nuraview/mcp serve
```

If you prefer a global install:

```bash
npm install -g @nuraview/mcp
nuraview-mcp
```

(`nuraview-mcp install` is the same installer with an explicit subcommand.)

Non-interactive example (Cursor user config, skip overwrite prompts):

```bash
nuraview-mcp install --target cursor-user -y
```

Point at a self-hosted API when generating the config:

```bash
nuraview-mcp install --target cursor-user -y --api-url https://nuraview.example.com
```

See all options:

```bash
nuraview-mcp install --help
```

If you are currently inside the local `packages/mcp` package directory, npm may resolve the local workspace package instead of the published one and fail to expose the bin. In that case, either run `npx` from outside `packages/mcp`, or use a local build:

```bash
node dist/index.js
```

The published package includes `dist/`. `prepublishOnly` runs the build before publish.

## Develop from source

From the repo root:

```bash
pnpm install
pnpm --filter @nuraview/mcp run build
pnpm --filter @nuraview/mcp run start
pnpm --filter @nuraview/mcp run test
```

Or run it from the package directory:

```bash
pnpm -C packages/mcp run build
```

The CLI entry points to `./dist/index.js`. Use `npx @nuraview/mcp` or `nuraview-mcp` after a global install so your IDE config points at the resolved path.

## Authentication

On the first tool call that needs NuraView, the server:

1. Requests a device code from `POST /api/auth/device/code`
2. Prints the verification URL and user code to `stderr`
3. Tries to open the browser
4. Polls `POST /api/auth/device/token` until approved
5. Stores the access token at `~/.config/nuraview-mcp/credentials.json` with mode `0600`

### Non-interactive (API key)

For headless or sandboxed environments where opening a browser is impractical, set `NURAVIEW_API_KEY` to a key created under Settings → Account → Developer. The server sends it as a Bearer token on every request and skips the device flow entirely, so no token is cached to disk.

## Tools

- Session: `whoami`, `list_workspaces`
- Projects: `list_projects`, `get_project`, `create_project`, `update_project`
- Tasks: `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task`, `update_task_status`
- Comments: `list_task_comments`, `create_task_comment`, `update_task_comment`, `delete_task_comment`
- Labels: `list_workspace_labels`, `create_label`, `attach_label_to_task`, `detach_label_from_task`, `delete_label`
- Task relations: `create_task_relation`, `get_task_relations`, `delete_task_relation`

## Releasing

Bump `version` in `packages/mcp/package.json` and merge to `main`. The [publish workflow](../../.github/workflows/publish-mcp.yml) runs the package tests, publishes the new version to npm, and creates a `mcp-v<version>` GitHub release. Nothing is published while the version stays the same, so tool changes reach npm only once the version is bumped.

Publishing a GitHub release manually also works: tag it `mcp-v<version>` with the tag version matching `packages/mcp/package.json` on the tagged commit.
