import * as vscode from "vscode";
import type { DiffFile, DiffSide } from "@presence/protocol";
import { DIFF_SCHEME, OPEN_DIFF_COMMAND } from "../constants";
import { queryParam } from "../util/paths";

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

/** The inverse of {@link diffUri}; undefined for any other scheme or side. */
export function parseDiffUri(
  uri: vscode.Uri,
): { ownerId: string; path: string; side: DiffSide } | undefined {
  if (uri.scheme !== DIFF_SCHEME) return undefined;
  const side = queryParam(uri, "side");
  if (side !== "before" && side !== "after") return undefined;
  const decoded = decodeURIComponent(uri.path);
  const path = decoded.replace(/^\//, "");
  return { ownerId: uri.authority, path, side };
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
    const parsed = parseDiffUri(uri);
    if (!parsed) return "";
    const file = this.diffsByUser
      .get(parsed.ownerId)
      ?.find((f) => f.path === parsed.path);
    if (!file) return "";
    return parsed.side === "before" ? file.before : file.after;
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
