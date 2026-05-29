import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { getServerUrl, resolveDisplayName, resolveRoomId } from "./config";
import { PresenceController } from "./presenceController";

let controller: PresenceController | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const log = vscode.window.createOutputChannel("Presence");
  context.subscriptions.push(log);

  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const session = {
      id: randomUUID(), // unique per session; how we recognize ourselves
      name: await resolveDisplayName(),
      room: await resolveRoomId(folder),
      folder,
    };
    log.appendLine(
      `[presence] activating — user="${session.name}" room=${session.room} ` +
        `url=${getServerUrl()} folder=${folder?.uri.fsPath ?? "<none>"}`,
    );

    controller = new PresenceController(context, session, log);
    await controller.start();
    log.appendLine("[presence] started");
  } catch (err) {
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.appendLine(`[presence] ACTIVATION FAILED: ${detail}`);
    void vscode.window.showErrorMessage(`Presence failed to activate: ${err}`);
    throw err;
  }
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
