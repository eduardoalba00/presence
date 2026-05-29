# Presence

See which file each teammate currently has open — and peek at their uncommitted
changes — right inside VS Code. **Presence only:** no code syncing, no edits to
your files, no cursor positions. Just shared awareness of who's where.

## Install

- **VS Code** — install from the
  [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=EduardoAlba.presence-extension),
  or search "Presence" in the Extensions view.
- **Cursor, VSCodium, Gitpod, and other VS Code–compatible editors** — install
  from the [Open VSX Registry](https://open-vsx.org/extension/EduardoAlba/presence-extension),
  or search "Presence" in the editor's Extensions view (these editors pull from
  Open VSX).
- **Manual** — download the `.vsix` from the
  [GitHub releases](https://github.com/eduardoalba00/presence/releases) and run
  **Extensions: Install from VSIX…** from the Command Palette.

## Features

- **Teammates view** — every connected teammate shown with a colored initials
  avatar and a presence dot (green active / amber idle), their current **git
  branch** and file (`branch • filename · folder`), and `(you)` on your own row.
- **Read-only diff sharing** — expand a teammate to see their uncommitted
  changes (working tree + staged + untracked vs `HEAD`). Click a file to open it
  in VS Code's native **read-only diff editor**, with real file-type icons and
  `M`/`A`/`U`/`D` status letters — just like your own Source Control view.
- **Explorer badges** — any file a teammate has open gets an initials badge and
  a colored tint in the Explorer; hover to see who's there.
- **Same-file collision** — when a teammate is editing the exact file you have
  open, their row turns red and you get a heads-up toast.
- **Connection status** in the status bar, and a one-click **pause** to stop
  sharing your activity at any time.

## Requirements

Presence needs a small **relay server** that connects teammates in the same
room. A room is derived automatically from your workspace's git remote (or
folder name), so teammates who open the same repo meet without any setup.

Point the extension at a relay via the **Set Relay URL** button in the
Teammates view title, or the `presence.serverUrl` setting. `wss://` is supported
for TLS. The relay source lives in the
[project repository](https://github.com/eduardoalba00/presence).

## Settings

| Setting              | Default               | Description                                            |
| -------------------- | --------------------- | ------------------------------------------------------ |
| `presence.serverUrl` | `ws://localhost:8080` | WebSocket URL of the presence relay.                   |
| `presence.userName`  | _(empty)_             | Display name shown to teammates; prompts on first run. |

## Privacy

While active, Presence shares your current file, git branch, and **uncommitted
diff** with everyone connected to the same relay and repo. Use the **Pause**
button (Teammates view title) whenever you don't want to share — it disconnects
you until you resume, and the choice persists across sessions.

## Commands

- **Presence: Pause Presence** / **Resume Presence**
- **Presence: Set Relay URL…**

## License

[MIT](./LICENSE)
