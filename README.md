# Presence

File-level presence for teammates. Each connected teammate can see which file
every other teammate currently has open — nothing more. **This is presence
only:** no code syncing, no edits, no cursor positions. Just "who is on what
file."

The project is a pnpm monorepo with two packages:

| Package      | What it is                                              |
| ------------ | ------------------------------------------------------- |
| `server/`    | A dumb Node WebSocket relay (`ws`). Stores + echoes.    |
| `extension/` | A VS Code extension (TypeScript) that shows the roster. |

## How it works

1. The extension connects to the relay over WebSocket and sends a `hello` with
   your display name and a **room id** derived from your workspace (the hash of
   the git remote URL, or the workspace folder name if there's no remote).
2. Whenever you switch the active editor, it sends an `update` with the file
   path **relative to the workspace root** (never an absolute path).
3. The relay keeps an in-memory roster per room and broadcasts it to everyone
   **in the same room** after any change. The extension renders it in a sidebar
   TreeView.

Only people whose workspace resolves to the same room id see each other — so
two people who open the same git repo land in the same room automatically.

### Message contract

```
client -> server: { type: "hello",  name: string, room: string, id?: string }
client -> server: { type: "update", file: string }
server -> client: { type: "roster", users: { id, name, file }[] }
```

The client supplies its own `id` in `hello` so it can recognize itself in the
roster (used to mark the `(you)` entry) regardless of display name; if omitted,
the server assigns one. Matching on `id` instead of `name` means two teammates
sharing a display name are still distinguished.

## Prerequisites

- Node.js 18+ (developed on Node 24)
- [pnpm](https://pnpm.io) (developed on pnpm 10)
- VS Code 1.85+

## Install

From the repo root:

```bash
pnpm install
```

This installs dependencies for both workspace packages.

## Run the server

```bash
pnpm start          # from the repo root
# or:  pnpm --filter @presence/server start
# or:  cd server && pnpm start
```

The relay listens on `ws://localhost:8080`. Override the port with the `PORT`
environment variable:

```bash
PORT=9000 pnpm start
```

`pnpm start` compiles the TypeScript and then runs the server. To rebuild on
change while developing, use `cd server && pnpm dev`.

On startup the relay prints every URL it's reachable at — `ws://localhost:8080`
plus your LAN IP(s) — so you can copy the right `ws://<ip>:8080` straight into a
teammate's `presence.serverUrl`.

## Run the extension (F5)

1. Build the extension once (so the launch task has output to run):
   `pnpm --filter presence-extension build` — or just press F5, which builds
   first via the configured `preLaunchTask`.
2. Open the **`extension/`** folder in VS Code.
3. Press **F5**. This launches an **Extension Development Host** window with the
   Presence extension loaded.
4. In that host window, **open a folder/repo** you want to share presence for.
5. Click the **Presence** icon in the activity bar to see the **Teammates**
   view. You'll see yourself, marked `(you)`, alongside the file you have open.

### Settings

| Setting               | Default                | Description                                                              |
| --------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `presence.serverUrl`  | `ws://localhost:8080`  | WebSocket URL of the relay.                                              |
| `presence.userName`   | _(empty)_              | Your display name. If empty on first activation, you're prompted for it. |

If `presence.userName` is empty and you dismiss the prompt, the extension falls
back to your OS username.

## Testing with two windows / two people

The room id is derived from the workspace, so the key is that **both sides open
the same repo and point at the same server**.

**Two people, two machines:**

1. One person runs the relay: `pnpm start`. Make it reachable (same LAN, or
   tunnel/forward port 8080).
2. Both set `presence.serverUrl` to that relay (e.g.
   `ws://<host>:8080`) in their VS Code settings.
3. Both open the **same git repository** (same `remote.origin.url`). They'll be
   placed in the same room and see each other in the Teammates view.

**One machine, two windows (quick local test):**

1. Run the relay locally: `pnpm start`.
2. Press F5 in the `extension/` folder to open Extension Development Host #1,
   and open some repo in it.
3. Open a **second** Extension Development Host: either press F5 again from
   another VS Code window, or in the host window open the same repo in a new
   window. Set a different `presence.userName` for each so you can tell them
   apart (the value is saved globally, so override it per window via the
   prompt or workspace settings).
4. Switch the active file in one window — the other window's Teammates view
   updates to show the new file.

> Tip: because `presence.userName` is stored in global settings, the simplest
> way to simulate two distinct people on one machine is to clear the setting in
> one window and answer the prompt with a different name, or set
> `presence.userName` in **workspace** settings for each copy of the repo.

## Project layout

```
presence/
├── package.json          # workspace scripts (build, start)
├── pnpm-workspace.yaml
├── server/
│   ├── src/index.ts      # the relay: rooms, roster broadcast, heartbeat
│   └── package.json
└── extension/
    ├── src/extension.ts  # ws client, reconnect, TreeView roster
    ├── media/presence.svg
    ├── .vscode/          # launch.json (F5) + tasks.json (build)
    └── package.json
```

## Resilience

- **Heartbeat:** the server pings every 30s and terminates clients that don't
  pong, cleaning up dead connections.
- **Reconnect:** if the socket drops, the extension reconnects with exponential
  backoff (capped at 30s) and re-sends `hello` + the current file on reconnect.
- **Cleanup:** the extension closes its socket on `deactivate`.
