import * as vscode from "vscode";
import type { DiffFile, User } from "@presence/protocol";
import { FILE_SCHEME, OPEN_DIFF_COMMAND, USER_SCHEME } from "../constants";
import { locationLabel, workspaceUri } from "../util/paths";
import { AvatarCache } from "./avatars";

/** A tree node is either a teammate or one of their changed files. */
export type RosterNode =
  | { kind: "user"; user: User }
  | { kind: "file"; userId: string; userName: string; file: DiffFile };

/**
 * Renders the Teammates tree: each person at the top level (avatar, branch,
 * file, presence/collision hints), expandable into the files they've changed.
 * Holds only view state; re-renders on roster/diffs/own-file updates.
 */
export class RosterProvider implements vscode.TreeDataProvider<RosterNode> {
  private users: User[] = [];
  private diffsByUser = new Map<string, DiffFile[]>();
  private myFile = ""; // our own active file, for collision detection
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly myId: string,
    private readonly avatars: AvatarCache,
    private readonly folder: vscode.WorkspaceFolder | undefined,
  ) {}

  setRoster(users: User[]): void {
    // Stable display order: yourself first, then alphabetical.
    this.users = [...users].sort((a, b) => {
      const am = a.id === this.myId ? 0 : 1;
      const bm = b.id === this.myId ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name);
    });
    this.emitter.fire();
  }

  setDiffs(diffsByUser: Map<string, DiffFile[]>): void {
    this.diffsByUser = diffsByUser;
    this.emitter.fire();
  }

  /** Our current file — used to flag teammates editing the same one. */
  setMyFile(file: string): void {
    if (file === this.myFile) return;
    this.myFile = file;
    this.emitter.fire();
  }

  getChildren(node?: RosterNode): RosterNode[] {
    if (!node) {
      return this.users.map((user) => ({ kind: "user", user }));
    }
    if (node.kind === "user") {
      const files = this.diffsByUser.get(node.user.id) ?? [];
      return files.map((file) => ({
        kind: "file",
        userId: node.user.id,
        userName: node.user.name,
        file,
      }));
    }
    return [];
  }

  getTreeItem(node: RosterNode): vscode.TreeItem {
    return node.kind === "user"
      ? this.userItem(node.user)
      : this.fileItem(node);
  }

  private userItem(user: User): vscode.TreeItem {
    const isMe = user.id === this.myId;
    const changeCount = this.diffsByUser.get(user.id)?.length ?? 0;
    const collision = !isMe && !!user.file && user.file === this.myFile;
    const idle = user.status === "idle";

    const item = new vscode.TreeItem(
      isMe ? `${user.name} (you)` : user.name,
      changeCount > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `user:${user.id}`;
    item.description = this.userDescription(user, { collision, idle });
    item.iconPath = this.avatars.iconFor(user.name, user.status);
    item.tooltip = this.userTooltip(user, {
      isMe,
      collision,
      idle,
      changeCount,
    });

    // A resourceUri lets the collision decoration provider paint the row red.
    if (collision) {
      item.resourceUri = vscode.Uri.from({
        scheme: USER_SCHEME,
        path: `/${user.id}`,
        query: "collision=1",
      });
    }

    // Click a teammate to jump to the file they're on.
    const target = workspaceUri(this.folder, user.file);
    if (target) {
      item.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [target],
      };
    }
    return item;
  }

  private userDescription(
    user: User,
    flags: { collision: boolean; idle: boolean },
  ): string {
    const where = locationLabel(user.file);
    const base = user.branch ? `${user.branch} • ${where}` : where;
    const hints = [
      flags.collision ? "⚠ same file" : "",
      flags.idle ? "idle" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return hints ? `${base} · ${hints}` : base;
  }

  private userTooltip(
    user: User,
    flags: {
      isMe: boolean;
      collision: boolean;
      idle: boolean;
      changeCount: number;
    },
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${user.name}**${flags.isMe ? " _(you)_" : ""}\n\n`);
    if (user.branch) md.appendMarkdown(`$(git-branch) \`${user.branch}\`\n\n`);
    md.appendMarkdown(
      user.file ? `$(file) \`${user.file}\`` : "_no file open_",
    );
    if (flags.collision)
      md.appendMarkdown(`\n\n$(warning) You're both editing this file.`);
    if (flags.idle) md.appendMarkdown(`\n\n$(circle-slash) idle`);
    if (flags.changeCount > 0)
      md.appendMarkdown(
        `\n\n$(git-commit) ${flags.changeCount} uncommitted file(s)`,
      );
    return md;
  }

  private fileItem(node: {
    userId: string;
    userName: string;
    file: DiffFile;
  }): vscode.TreeItem {
    const { file } = node;
    const slash = file.path.lastIndexOf("/");
    const name = slash === -1 ? file.path : file.path.slice(slash + 1);
    const dir = slash === -1 ? "" : file.path.slice(0, slash);

    const item = new vscode.TreeItem(
      name,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `file:${node.userId}:${file.path}`;
    item.description = dir;
    // resourceUri (not iconPath) so the active file-icon theme renders the real
    // file-type icon (TS, JSON, …); the status letter comes from the decoration
    // provider for this scheme. Status rides in the query.
    item.resourceUri = vscode.Uri.from({
      scheme: FILE_SCHEME,
      path: "/" + file.path,
      query: `status=${file.status}`,
    });
    item.tooltip = `${node.userName} — ${file.path} (${file.status})`;
    item.contextValue = "presenceDiffFile";

    // Click a changed file to open its read-only diff.
    if (file.status !== "binary" && file.status !== "large") {
      item.command = {
        command: OPEN_DIFF_COMMAND,
        title: "Open Diff",
        arguments: [node.userId, node.userName, file],
      };
    }
    return item;
  }
}
