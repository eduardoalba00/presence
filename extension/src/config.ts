import * as vscode from "vscode";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { DEFAULT_SERVER_URL } from "./constants";

/** Reads user settings and derives the room id from the workspace. */

const CONFIG_SECTION = "presence";

/** The relay URL from settings, falling back to the local default. */
export function getServerUrl(): string {
  const configured = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>("serverUrl")
    ?.trim();
  return configured || DEFAULT_SERVER_URL;
}

/** Persist a new relay URL to user settings. */
export async function setServerUrl(url: string): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update("serverUrl", url, vscode.ConfigurationTarget.Global);
}

/** True when a configuration change touched `presence.serverUrl`. */
export function affectsServerUrl(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration(`${CONFIG_SECTION}.serverUrl`);
}

/**
 * Resolve our display name: the `presence.userName` setting, else a prompt
 * (whose answer is saved), else the OS username.
 */
export async function resolveDisplayName(): Promise<string> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
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

/**
 * Derive a room id from the workspace so teammates on the same repo meet
 * automatically: a hash of the git remote URL, else of the folder name.
 */
export async function resolveRoomId(
  folder: vscode.WorkspaceFolder | undefined,
): Promise<string> {
  if (!folder) return shortHash("presence:no-workspace");
  const remote = await gitRemoteUrl(folder.uri.fsPath);
  return shortHash(remote ?? `folder:${folder.name}`);
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
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
      },
    );
  });
}
