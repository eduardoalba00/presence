import * as vscode from "vscode";
import type { DiffEntry, User } from "@presence/protocol";
import {
  ACCESS_DENIED_CONTEXT,
  CONNECTED_CONTEXT,
  DIFF_SCHEME,
  PAUSE_COMMAND,
  PAUSED_CONTEXT,
  RESUME_COMMAND,
  RETRY_ACCESS_COMMAND,
  ROSTER_VIEW_ID,
  SET_URL_COMMAND,
} from "./constants";
import {
  affectsServerUrl,
  getServerUrl,
  setServerUrl,
  verifyRepoAccess,
} from "./config";
import { ActivityTracker } from "./activityTracker";
import { PresenceClient, type ConnectionState } from "./presenceClient";
import { DiffWatcher } from "./git/diffWatcher";
import { AvatarCache } from "./ui/avatars";
import { RosterProvider, type RosterNode } from "./ui/rosterProvider";
import { StatusBar } from "./ui/statusBar";
import { DiffContentProvider, registerOpenDiffCommand } from "./ui/diffViewer";
import {
  CollisionDecorations,
  DiffStatusDecorations,
  ExplorerPresenceDecorations,
} from "./ui/decorations";
import { relativeFileOf } from "./util/paths";

/** Identity + workspace context for a presence session. */
export interface PresenceSession {
  id: string;
  name: string;
  room: string;
  folder: vscode.WorkspaceFolder | undefined;
}

/**
 * Composition root: builds the client, tree, decorations, diff watcher, and
 * activity tracker, and routes server events to the UI. Owns all disposables.
 */
export class PresenceController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly client: PresenceClient;
  private readonly watcher: DiffWatcher;
  private readonly activity: ActivityTracker;
  private readonly provider: RosterProvider;
  private readonly explorerDecorations: ExplorerPresenceDecorations;
  private readonly diffContent: DiffContentProvider;
  private readonly statusBar: StatusBar;
  private readonly treeView: vscode.TreeView<RosterNode>;

  private connection: ConnectionState = "connecting";
  private users: User[] = [];
  private collisions = new Set<string>();
  private paused: boolean;
  private accessDenied = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: PresenceSession,
    private readonly log: vscode.OutputChannel,
  ) {
    this.paused = context.globalState.get<boolean>(PAUSED_CONTEXT, false);
    const { id, name, room, folder } = session;
    const url = getServerUrl();

    const avatars = new AvatarCache();
    this.provider = new RosterProvider(id, avatars, folder);
    this.explorerDecorations = new ExplorerPresenceDecorations(folder, id);
    this.diffContent = new DiffContentProvider();
    this.statusBar = new StatusBar(url);
    this.treeView = vscode.window.createTreeView(ROSTER_VIEW_ID, {
      treeDataProvider: this.provider,
    });

    this.client = new PresenceClient(url, id, name, room, {
      onRoster: (users) => this.onRoster(users),
      onDiffs: (entries) => this.onDiffs(entries),
      onStatus: (state) => this.onStatus(state),
    });
    this.watcher = new DiffWatcher(
      folder,
      (files) => this.client.updateDiff(files),
      (branch) => this.client.updateBranch(branch),
    );
    this.activity = new ActivityTracker((status) =>
      this.client.updateStatus(status),
    );

    this.registerDisposables();
  }

  /** Begin reporting our own presence (unless we're paused from a prior session). */
  async start(): Promise<void> {
    // Gate on current repo access before doing anything that joins the room or
    // reads the working tree. Fail-closed: if we can't confirm access, we never
    // connect, so a stale clone on a revoked account can't surface in the pool.
    this.treeView.message = "Verifying repository access…";
    const access = await verifyRepoAccess(this.session.folder);
    if (!access.granted) {
      this.log.appendLine(
        `[presence] repo access denied: ${access.reason ?? "unknown"}`,
      );
      this.applyAccessDeniedUi();
      return;
    }
    this.treeView.message = undefined;
    void vscode.commands.executeCommand(
      "setContext",
      ACCESS_DENIED_CONTEXT,
      false,
    );

    // Always seed local state + watchers; the client buffers updates and only
    // sends them while connected, so this is safe even when paused.
    const file = relativeFileOf(vscode.window.activeTextEditor);
    this.client.updateFile(file);
    this.provider.setMyFile(file);
    void this.watcher.start();
    this.activity.start();

    void vscode.commands.executeCommand(
      "setContext",
      PAUSED_CONTEXT,
      this.paused,
    );
    if (this.paused) {
      this.client.pause(); // sync the client so resume() reconnects
      this.applyPausedUi();
    } else {
      this.client.start();
    }
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    void this.context.globalState.update(PAUSED_CONTEXT, true);
    void vscode.commands.executeCommand("setContext", PAUSED_CONTEXT, true);
    this.client.pause();
    this.applyPausedUi();
    this.log.appendLine("[presence] paused");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.context.globalState.update(PAUSED_CONTEXT, false);
    void vscode.commands.executeCommand("setContext", PAUSED_CONTEXT, false);
    this.statusBar.setPaused(false);
    this.client.resume();
    // Re-send the file we're on so teammates see us immediately on resume.
    this.client.updateFile(relativeFileOf(vscode.window.activeTextEditor));
    this.log.appendLine("[presence] resumed");
  }

  /** Clear the now-stale roster and reflect the paused state in the UI. */
  private applyPausedUi(): void {
    this.users = [];
    this.collisions = new Set();
    this.provider.setRoster([]);
    this.provider.setDiffs(new Map());
    this.explorerDecorations.setRoster([]);
    this.statusBar.setPaused(true);
    this.treeView.message = undefined;
    void vscode.commands.executeCommand("setContext", CONNECTED_CONTEXT, false);
  }

  /** Reflect that repo access couldn't be confirmed; nothing has joined the room. */
  private applyAccessDeniedUi(): void {
    this.accessDenied = true;
    this.users = [];
    this.collisions = new Set();
    this.provider.setRoster([]);
    this.provider.setDiffs(new Map());
    this.explorerDecorations.setRoster([]);
    this.statusBar.setAccessDenied(true);
    this.treeView.message = undefined; // the welcome view explains the state
    void vscode.commands.executeCommand(
      "setContext",
      ACCESS_DENIED_CONTEXT,
      true,
    );
    void vscode.commands.executeCommand("setContext", CONNECTED_CONTEXT, false);
    void vscode.commands.executeCommand("setContext", PAUSED_CONTEXT, false);
  }

  /** Re-run the access check (e.g. after the user reconnects to the VPN). */
  private async retryAccess(): Promise<void> {
    if (!this.accessDenied) return;
    this.accessDenied = false;
    this.statusBar.setAccessDenied(false);
    await this.start();
  }

  /** Prompt for a relay URL and persist it; the change triggers a reconnect. */
  private async promptForServerUrl(): Promise<void> {
    const url = await vscode.window.showInputBox({
      title: "Presence relay URL",
      prompt: "WebSocket URL of the presence relay (ws:// or wss://)",
      value: getServerUrl(),
      ignoreFocusOut: true,
      validateInput: (v) =>
        /^wss?:\/\/.+/.test(v.trim())
          ? undefined
          : "Must start with ws:// or wss://",
    });
    if (url) await setServerUrl(url.trim());
  }

  dispose(): void {
    this.client.dispose();
    this.watcher.dispose();
    this.activity.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private registerDisposables(): void {
    this.disposables.push(
      this.treeView,
      this.statusBar,
      vscode.window.registerFileDecorationProvider(this.explorerDecorations),
      vscode.window.registerFileDecorationProvider(new DiffStatusDecorations()),
      vscode.window.registerFileDecorationProvider(new CollisionDecorations()),
      vscode.workspace.registerTextDocumentContentProvider(
        DIFF_SCHEME,
        this.diffContent,
      ),
      registerOpenDiffCommand(),
      vscode.commands.registerCommand(PAUSE_COMMAND, () => this.pause()),
      vscode.commands.registerCommand(RESUME_COMMAND, () => this.resume()),
      vscode.commands.registerCommand(RETRY_ACCESS_COMMAND, () =>
        this.retryAccess(),
      ),
      vscode.commands.registerCommand(SET_URL_COMMAND, () =>
        this.promptForServerUrl(),
      ),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (affectsServerUrl(e)) {
          const url = getServerUrl();
          this.statusBar.setUrl(url);
          this.client.changeUrl(url);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() =>
        this.onActiveEditorChanged(),
      ),
    );
  }

  // --- server events -------------------------------------------------------

  private onRoster(users: User[]): void {
    this.users = users;
    this.log.appendLine(
      `[presence] roster: ${users.length} user(s), ${this.others().length} other(s)`,
    );
    this.provider.setRoster(users);
    this.explorerDecorations.setRoster(users);
    this.statusBar.setOnline(this.others().length);
    this.updateTreeMessage();
    this.detectCollisions();
  }

  private onDiffs(entries: DiffEntry[]): void {
    const byUser = new Map(entries.map((e) => [e.id, e.files]));
    this.provider.setDiffs(byUser);
    this.diffContent.update(byUser);
  }

  private onStatus(state: ConnectionState): void {
    this.connection = state;
    this.log.appendLine(`[presence] connection: ${state}`);
    this.statusBar.setState(state);
    void vscode.commands.executeCommand(
      "setContext",
      CONNECTED_CONTEXT,
      state === "connected",
    );
    this.updateTreeMessage();
  }

  // --- local events --------------------------------------------------------

  private onActiveEditorChanged(): void {
    this.client.updateFile(relativeFileOf(vscode.window.activeTextEditor));
    this.detectCollisions();
  }

  /** Warn (once) when a teammate is editing the file we currently have open. */
  private detectCollisions(): void {
    const myFile = relativeFileOf(vscode.window.activeTextEditor);
    this.provider.setMyFile(myFile);
    const next = new Set<string>();
    if (myFile) {
      for (const u of this.users) {
        if (u.id === this.session.id || u.file !== myFile) continue;
        const key = `${u.id}@${myFile}`;
        next.add(key);
        if (!this.collisions.has(key)) {
          vscode.window.showWarningMessage(
            `You and ${u.name} are both editing ${myFile}`,
          );
        }
      }
    }
    this.collisions = next;
  }

  private updateTreeMessage(): void {
    // Connection/paused states are shown via the status bar + welcome view;
    // here we only annotate the "connected but alone" case (your row is shown).
    this.treeView.message =
      !this.paused &&
      this.connection === "connected" &&
      this.others().length === 0
        ? "No teammates on this repo yet."
        : undefined;
  }

  private others(): User[] {
    return this.users.filter((u) => u.id !== this.session.id);
  }
}
