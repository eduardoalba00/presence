import * as vscode from "vscode";
import type { DiffStatus, User } from "@presence/protocol";
import { FILE_SCHEME, USER_SCHEME } from "../constants";
import { normalizePath, queryParam } from "../util/paths";
import { initialsOf } from "../util/text";

/**
 * Explorer decorations: badge any file a teammate currently has open with the
 * first teammate's initials and a colored tint; the tooltip lists everyone.
 */
export class ExplorerPresenceDecorations
  implements vscode.FileDecorationProvider
{
  // workspace-relative path -> names of OTHER teammates on that file
  private byPath = new Map<string, string[]>();
  private decorated: vscode.Uri[] = [];
  private readonly emitter = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  constructor(
    private readonly folder: vscode.WorkspaceFolder | undefined,
    private readonly myId: string,
  ) {}

  setRoster(users: User[]): void {
    const next = new Map<string, string[]>();
    for (const u of users) {
      if (!u.file || u.id === this.myId) continue; // skip empty + yourself
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
    this.emitter.fire([...this.decorated, ...nextUris]);
    this.decorated = nextUris;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.folder) return undefined;
    const rel = normalizePath(vscode.workspace.asRelativePath(uri, false));
    const names = this.byPath.get(rel);
    if (!names?.length) return undefined;
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    const extra = sorted.length > 1 ? ` (+${sorted.length - 1} more)` : "";
    return {
      // 2-char badge: the first teammate's initials (who's who is in the tooltip).
      badge: initialsOf(sorted[0]),
      tooltip: `Presence: ${sorted.join(", ")}${extra}`,
      color: new vscode.ThemeColor("charts.blue"),
      propagate: true, // also tint parent folders so collapsed trees show it
    };
  }

  private toUri(relPath: string): vscode.Uri | undefined {
    if (!this.folder) return undefined;
    return vscode.Uri.joinPath(this.folder.uri, ...relPath.split("/"));
  }
}

// Single-letter status badge + matching theme color, mirroring VS Code's own
// Source Control view (M/A/U/D in the git decoration colors).
const STATUS_LETTER: Record<DiffStatus, string> = {
  modified: "M",
  added: "A",
  untracked: "U",
  deleted: "D",
  binary: "B",
  large: "L",
};
const STATUS_COLOR: Record<DiffStatus, string | undefined> = {
  modified: "gitDecoration.modifiedResourceForeground",
  added: "gitDecoration.addedResourceForeground",
  untracked: "gitDecoration.untrackedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
  binary: undefined,
  large: undefined,
};

/**
 * Paints the M/A/U/D status letter (in the matching git theme color) on diff
 * file rows. Only touches the `presence-file` scheme; status rides in the query.
 */
export class DiffStatusDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== FILE_SCHEME) return undefined;
    const status = queryParam(uri, "status") as DiffStatus | null;
    if (!status) return undefined;
    const color = STATUS_COLOR[status];
    return {
      badge: STATUS_LETTER[status],
      tooltip: status,
      color: color ? new vscode.ThemeColor(color) : undefined,
    };
  }
}

/**
 * Paints same-file collisions red on user rows (a teammate editing the file you
 * currently have open). Only touches the `presence-user` scheme.
 */
export class CollisionDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== USER_SCHEME) return undefined;
    if (queryParam(uri, "collision") !== "1") return undefined;
    return {
      badge: "!",
      tooltip: "Editing the same file as you",
      color: new vscode.ThemeColor("errorForeground"),
    };
  }
}
