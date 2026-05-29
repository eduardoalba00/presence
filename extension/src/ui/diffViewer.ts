import * as vscode from "vscode";
import type { DiffFile } from "@presence/protocol";
import { DIFF_SCHEME, OPEN_DIFF_COMMAND } from "../constants";
import { queryParam } from "../util/paths";

type DiffSide = "before" | "after";

/** `presence-diff://<userId>/<repo-relative-path>?side=before|after` */
export function diffUri(
  userId: string,
  path: string,
  side: DiffSide,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: DIFF_SCHEME,
    authority: userId,
    path: "/" + path,
    query: `side=${side}`,
  });
}

/**
 * Serves both sides of a teammate's change as read-only virtual documents, so
 * VS Code's native diff editor can render them. Open docs refresh when the
 * underlying diff changes.
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private diffsByUser = new Map<string, DiffFile[]>();
  private readonly served = new Set<string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  update(diffsByUser: Map<string, DiffFile[]>): void {
    this.diffsByUser = diffsByUser;
    for (const key of this.served) this.emitter.fire(vscode.Uri.parse(key));
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    this.served.add(uri.toString());
    const side = queryParam(uri, "side");
    const path = decodeURIComponent(uri.path).replace(/^\//, "");
    const file = this.diffsByUser
      .get(uri.authority)
      ?.find((f) => f.path === path);
    if (!file) return "";
    return side === "before" ? file.before : file.after;
  }
}

/** Registers the command behind clicking a changed file in the tree. */
export function registerOpenDiffCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(OPEN_DIFF_COMMAND, openDiff);
}

async function openDiff(
  userId: string,
  userName: string,
  file: DiffFile,
): Promise<void> {
  if (file.status === "binary" || file.status === "large") {
    const reason = file.status === "binary" ? "binary file" : "diff too large";
    vscode.window.showInformationMessage(
      `${file.path}: ${reason} — not shown.`,
    );
    return;
  }
  await vscode.commands.executeCommand(
    "vscode.diff",
    diffUri(userId, file.path, "before"),
    diffUri(userId, file.path, "after"),
    `${userName}: ${file.path} (uncommitted)`,
    { preview: true },
  );
}
