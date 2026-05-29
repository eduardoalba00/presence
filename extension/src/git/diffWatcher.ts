import * as vscode from "vscode";
import type { DiffFile, DiffStatus } from "@presence/protocol";
import { DIFF_DEBOUNCE_MS, MAX_DIFF_CHARS } from "../constants";
import { normalizePath } from "../util/paths";
import { hasNullByte } from "../util/text";
import { getGitApi, type GitAPI, type GitRepository } from "./gitApi";

/**
 * Watches our own working tree via the Git API and reports, debounced:
 *  - the set of uncommitted changes (working tree + staged + untracked vs HEAD)
 *  - the current branch
 *
 * Does nothing (no callbacks) when the workspace has no git repository.
 */
export class DiffWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private repo?: GitRepository;
  private disposed = false;
  private lastBranch = "";

  constructor(
    private readonly folder: vscode.WorkspaceFolder | undefined,
    private readonly onDiff: (files: DiffFile[]) => void,
    private readonly onBranch: (branch: string) => void,
  ) {}

  async start(): Promise<void> {
    const api = await getGitApi();
    if (!api || this.disposed) return;

    const repo = this.pickRepo(api);
    if (repo) {
      this.bind(repo);
    } else {
      // Repositories can populate after activation; wait for one to open.
      this.disposables.push(
        api.onDidOpenRepository(() => {
          if (!this.repo) {
            const opened = this.pickRepo(api);
            if (opened) this.bind(opened);
          }
        }),
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }

  private pickRepo(api: GitAPI): GitRepository | undefined {
    if (api.repositories.length === 0) return undefined;
    if (this.folder) {
      const want = this.folder.uri.fsPath;
      const match = api.repositories.find(
        (r) =>
          want === r.rootUri.fsPath || want.startsWith(r.rootUri.fsPath + "/"),
      );
      if (match) return match;
    }
    return api.repositories[0];
  }

  private bind(repo: GitRepository): void {
    this.repo = repo;
    this.disposables.push(repo.state.onDidChange(() => this.schedule()));
    this.schedule(); // initial snapshot
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.compute(), DIFF_DEBOUNCE_MS);
  }

  private async compute(): Promise<void> {
    const repo = this.repo;
    if (!repo) return;
    const state = repo.state;

    // Branch is cheap and independent of the diff.
    const branch = state.HEAD?.name ?? "";
    if (branch !== this.lastBranch) {
      this.lastBranch = branch;
      this.onBranch(branch);
    }

    // Paths Git reports as untracked, so we can badge them "U" rather than "A".
    const untracked = new Set(
      (state.untrackedChanges ?? []).map((c) => this.repoRelative(repo, c.uri)),
    );
    const changes = [
      ...state.indexChanges,
      ...state.workingTreeChanges,
      ...(state.untrackedChanges ?? []),
      ...state.mergeChanges,
    ];

    const seen = new Set<string>();
    const files: DiffFile[] = [];
    for (const change of changes) {
      const rel = this.repoRelative(repo, change.uri);
      if (seen.has(rel)) continue;
      seen.add(rel);
      files.push(
        await this.buildDiff(repo, change.uri, rel, untracked.has(rel)),
      );
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    this.onDiff(files);
  }

  private async buildDiff(
    repo: GitRepository,
    uri: vscode.Uri,
    rel: string,
    isUntracked: boolean,
  ): Promise<DiffFile> {
    const before = await this.readHead(repo, uri);
    const working = await this.readWorking(uri);
    const status = classify(before, working, isUntracked);

    // Don't ship the bytes for binary/large files; the row stays but isn't openable.
    if (status === "binary" || status === "large") {
      return { path: rel, status, before: "", after: "" };
    }
    return { path: rel, status, before, after: working.text };
  }

  private async readHead(
    repo: GitRepository,
    uri: vscode.Uri,
  ): Promise<string> {
    try {
      return await repo.show("HEAD", uri.fsPath);
    } catch {
      return ""; // not in HEAD (added/untracked) or unreadable
    }
  }

  private async readWorking(
    uri: vscode.Uri,
  ): Promise<{ text: string; missing: boolean }> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return { text: Buffer.from(bytes).toString("utf8"), missing: false };
    } catch {
      return { text: "", missing: true }; // deleted on disk
    }
  }

  private repoRelative(repo: GitRepository, uri: vscode.Uri): string {
    const root = repo.rootUri.fsPath;
    let p = uri.fsPath;
    if (p.startsWith(root)) p = p.slice(root.length).replace(/^[/\\]/, "");
    return normalizePath(p);
  }
}

/** Decide a file's diff status from its two sides. */
function classify(
  before: string,
  working: { text: string; missing: boolean },
  isUntracked: boolean,
): DiffStatus {
  if (hasNullByte(before) || hasNullByte(working.text)) return "binary";
  if (before.length + working.text.length > MAX_DIFF_CHARS) return "large";
  if (working.missing) return "deleted";
  if (!before) return isUntracked ? "untracked" : "added";
  return "modified";
}
