import * as vscode from "vscode";

/** Path and URI helpers, all working in forward-slash, workspace-relative terms. */

/** Normalize OS path separators to forward slashes. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Workspace-relative path of an editor's document ("" when none). */
export function relativeFileOf(editor: vscode.TextEditor | undefined): string {
  if (!editor) return "";
  return vscode.workspace.asRelativePath(editor.document.uri, false);
}

/** "Button.tsx · src/components" — filename first, then its folder, dimmed. */
export function locationLabel(file: string): string {
  if (!file) return "no file open";
  const norm = normalizePath(file);
  const slash = norm.lastIndexOf("/");
  return slash === -1
    ? norm
    : `${norm.slice(slash + 1)} · ${norm.slice(0, slash)}`;
}

/** Resolve a workspace-relative path to an absolute uri within `folder`. */
export function workspaceUri(
  folder: vscode.WorkspaceFolder | undefined,
  file: string,
): vscode.Uri | undefined {
  if (!file || !folder) return undefined;
  return vscode.Uri.joinPath(folder.uri, ...normalizePath(file).split("/"));
}

/** Read a single query parameter from a uri. */
export function queryParam(uri: vscode.Uri, key: string): string | null {
  return new URLSearchParams(uri.query).get(key);
}
