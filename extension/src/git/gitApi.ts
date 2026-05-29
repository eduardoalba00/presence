import * as vscode from "vscode";

/**
 * A minimal slice of the built-in Git extension API (`vscode.git`) — just the
 * surface this extension depends on. The full type lives in the Git extension;
 * we declare only what we use to avoid a build dependency on it.
 */

export interface GitChange {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
  renameUri?: vscode.Uri;
  status: number;
}

export interface GitRepositoryState {
  indexChanges: GitChange[];
  workingTreeChanges: GitChange[];
  mergeChanges: GitChange[];
  untrackedChanges?: GitChange[];
  HEAD?: { name?: string };
  onDidChange: vscode.Event<void>;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
  /** File content at a ref, e.g. `show("HEAD", uri.fsPath)`. */
  show(ref: string, path: string): Promise<string>;
}

export interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

/** Resolve the Git extension's API, activating it if needed; undefined if absent. */
export async function getGitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports.getAPI(1);
}
