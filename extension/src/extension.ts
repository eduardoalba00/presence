import * as vscode from "vscode";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import WebSocket from "ws";

/** A teammate as reported by the relay roster. */
interface User {
  id: string;
  name: string;
  file: string;
}

interface RosterMessage {
  type: "roster";
  users: User[];
}

const DEFAULT_SERVER_URL = "ws://localhost:8080";

// ---------------------------------------------------------------------------
// WebSocket client: connect, hello, update, auto-reconnect with backoff.
// ---------------------------------------------------------------------------

class PresenceClient {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private attempt = 0;
  private disposed = false;
  private currentFile = "";

  constructor(
    private readonly url: string,
    private readonly name: string,
    private readonly room: string,
    private readonly onRoster: (users: User[]) => void
  ) {}

  start(): void {
    this.connect();
  }

  /** Update the file we're reporting; sends immediately if connected. */
  updateFile(file: string): void {
    this.currentFile = file;
    this.send({ type: "update", file });
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    if (this.disposed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.attempt = 0;
      // Re-announce ourselves and our current file on every (re)connect.
      this.send({ type: "hello", name: this.name, room: this.room });
      this.send({ type: "update", file: this.currentFile });
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as RosterMessage;
        if (msg.type === "roster" && Array.isArray(msg.users)) {
          this.onRoster(msg.users);
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on("close", () => this.scheduleReconnect());
    ws.on("error", () => {
      // A `close` event follows; reconnect is scheduled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    // Exponential backoff capped at 30s: 1, 2, 4, 8, 16, 30, 30, ...
    const delay = Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

// ---------------------------------------------------------------------------
// TreeView: render the roster, re-render on every roster message.
// ---------------------------------------------------------------------------

class RosterProvider implements vscode.TreeDataProvider<User> {
  private users: User[] = [];
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly myName: string) {}

  setRoster(users: User[]): void {
    // Sort for a stable display: yourself first, then alphabetical.
    this.users = [...users].sort((a, b) => {
      const am = a.name === this.myName ? 0 : 1;
      const bm = b.name === this.myName ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name);
    });
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(user: User): vscode.TreeItem {
    const isMe = user.name === this.myName;
    const item = new vscode.TreeItem(isMe ? `${user.name} (you)` : user.name);
    item.description = user.file || "—";
    item.tooltip = `${user.name} — ${user.file || "no file open"}`;
    item.iconPath = new vscode.ThemeIcon(isMe ? "account" : "person");
    return item;
  }

  getChildren(): User[] {
    return this.users;
  }
}

// ---------------------------------------------------------------------------
// File decorations: badge files in the Explorer with how many teammates (and,
// on hover, who) currently have them open.
// ---------------------------------------------------------------------------

const normalizePath = (p: string): string => p.replace(/\\/g, "/");

class PresenceDecorationProvider implements vscode.FileDecorationProvider {
  // relative path (forward-slash) -> names of OTHER teammates on that file
  private byPath = new Map<string, string[]>();
  private decorated: vscode.Uri[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  constructor(
    private readonly folder: vscode.WorkspaceFolder | undefined,
    private readonly myName: string
  ) {}

  setRoster(users: User[]): void {
    const next = new Map<string, string[]>();
    for (const u of users) {
      if (!u.file || u.name === this.myName) continue; // skip empty + yourself
      const key = normalizePath(u.file);
      const names = next.get(key) ?? [];
      names.push(u.name);
      next.set(key, names);
    }
    this.byPath = next;

    const nextUris = [...next.keys()]
      .map((p) => this.toUri(p))
      .filter((u): u is vscode.Uri => u !== undefined);
    // Refresh files that gained AND lost presence since the last roster.
    const changed = [...this.decorated, ...nextUris];
    this.decorated = nextUris;
    this._onDidChange.fire(changed);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.folder) return undefined;
    const rel = normalizePath(vscode.workspace.asRelativePath(uri, false));
    const names = this.byPath.get(rel);
    if (!names?.length) return undefined;
    return {
      badge: names.length > 9 ? "9+" : String(names.length),
      tooltip: `Presence: ${names.join(", ")}`,
      color: new vscode.ThemeColor("charts.blue"),
      propagate: true, // also tint parent folders so collapsed trees show it
    };
  }

  private toUri(relPath: string): vscode.Uri | undefined {
    if (!this.folder) return undefined;
    return vscode.Uri.joinPath(this.folder.uri, ...relPath.split("/"));
  }
}

// ---------------------------------------------------------------------------
// Helpers: display name and room id resolution.
// ---------------------------------------------------------------------------

async function resolveName(): Promise<string> {
  const config = vscode.workspace.getConfiguration("presence");
  const configured = config.get<string>("userName")?.trim();
  if (configured) return configured;

  const fallback = os.userInfo().username;
  const input = await vscode.window.showInputBox({
    prompt: "Enter your display name for Presence",
    value: fallback,
    ignoreFocusOut: true,
  });
  const chosen = input?.trim();
  if (chosen) {
    await config.update("userName", chosen, vscode.ConfigurationTarget.Global);
    return chosen;
  }
  return fallback;
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

/** Derive a room id: hash of the git remote URL, else the folder name. */
async function resolveRoomId(
  folder: vscode.WorkspaceFolder | undefined
): Promise<string> {
  if (!folder) return shortHash("presence:no-workspace");

  const remote = await gitRemoteUrl(folder.uri.fsPath);
  return shortHash(remote ?? `folder:${folder.name}`);
}

function gitRemoteUrl(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd },
      (err, stdout) => {
        const url = stdout?.trim();
        resolve(!err && url ? url : undefined);
      }
    );
  });
}

function relativeFileOf(editor: vscode.TextEditor | undefined): string {
  if (!editor) return "";
  return vscode.workspace.asRelativePath(editor.document.uri, false);
}

// ---------------------------------------------------------------------------
// Activation.
// ---------------------------------------------------------------------------

let client: PresenceClient | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const config = vscode.workspace.getConfiguration("presence");
  const url = config.get<string>("serverUrl")?.trim() || DEFAULT_SERVER_URL;

  const name = await resolveName();
  const room = await resolveRoomId(folder);

  const provider = new RosterProvider(name);
  const decorations = new PresenceDecorationProvider(folder, name);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("presence.roster", provider),
    vscode.window.registerFileDecorationProvider(decorations)
  );

  client = new PresenceClient(url, name, room, (users) => {
    provider.setRoster(users);
    decorations.setRoster(users);
  });
  client.start();

  // Report the file that's already open at startup.
  client.updateFile(relativeFileOf(vscode.window.activeTextEditor));

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      client?.updateFile(relativeFileOf(editor));
    }),
    { dispose: () => client?.dispose() }
  );
}

export function deactivate(): void {
  client?.dispose();
  client = undefined;
}
