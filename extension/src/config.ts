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
 * automatically: a hash of the canonicalized git remote, else of the folder
 * name. Normalizing the remote first means HTTPS and SSH clones of the same
 * repository land in the same room.
 */
export async function resolveRoomId(
  folder: vscode.WorkspaceFolder | undefined,
): Promise<string> {
  if (!folder) return shortHash("presence:no-workspace");
  const remote = await gitRemoteUrl(folder.uri.fsPath);
  return shortHash(
    remote ? `repo:${normalizeRemoteUrl(remote)}` : `folder:${folder.name}`,
  );
}

/**
 * Canonicalize a git remote URL so the same repository maps to one identity
 * regardless of clone protocol (HTTPS / SSH / git://) or embedded credentials.
 * Returns `host/path` with the host lowercased and any scheme, userinfo, port,
 * trailing slash, and `.git` suffix removed. Unrecognized inputs fall back to
 * the lowercased original so they still hash deterministically.
 *
 * All of these collapse to `github.com/acme/widget`:
 *   https://github.com/acme/widget.git
 *   git@github.com:acme/widget.git
 *   ssh://git@github.com:22/acme/widget.git
 *   git://github.com/acme/widget
 *   https://x-access-token:TOKEN@github.com/acme/widget.git
 */
export function normalizeRemoteUrl(remote: string): string {
  const s = remote.trim();
  let host: string;
  let path: string;

  if (s.includes("://")) {
    // Scheme-based URL (https, http, ssh, git). The URL parser drops userinfo
    // and exposes host/port separately, so credentials and ports fall away.
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return s.toLowerCase();
    }
    host = url.hostname;
    path = url.pathname;
  } else {
    // scp-like syntax with no scheme: [user@]host:path
    const afterUser = s.slice(s.indexOf("@") + 1); // no "@" → indexOf is -1 → whole string
    const colon = afterUser.indexOf(":");
    if (colon < 0) return s.toLowerCase();
    host = afterUser.slice(0, colon);
    path = afterUser.slice(colon + 1);
  }

  host = host.toLowerCase();
  path = path
    .replace(/^\/+/, "") // leading slashes
    .replace(/\.git$/i, "") // trailing .git
    .replace(/\/+$/, ""); // trailing slashes

  return `${host}/${path}`;
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

/** Outcome of an access check; `reason` is populated only when denied. */
export interface AccessResult {
  granted: boolean;
  reason?: string;
}

/** How long to wait for `git ls-remote` before treating it as a failure. */
const ACCESS_CHECK_TIMEOUT_MS = 10_000;

/**
 * Confirm the user *currently* has access to the workspace's git remote by
 * asking the server for its refs (`git ls-remote`). This exercises their live
 * credentials, so a revoked SSH key or token fails here even though a stale
 * clone still sits on disk.
 *
 * Fail-closed: when a remote exists, anything other than a clean success — auth
 * denied, offline, timeout — denies access. A workspace with no git remote has
 * no access to gate, so it is granted (it joins a local, folder-name room just
 * as before).
 */
export async function verifyRepoAccess(
  folder: vscode.WorkspaceFolder | undefined,
): Promise<AccessResult> {
  if (!folder) return { granted: true };
  const remote = await gitRemoteUrl(folder.uri.fsPath);
  if (!remote) return { granted: true }; // nothing to verify
  return lsRemote(folder.uri.fsPath, remote);
}

function lsRemote(cwd: string, remote: string): Promise<AccessResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      ["ls-remote", "--quiet", remote],
      {
        cwd,
        timeout: ACCESS_CHECK_TIMEOUT_MS,
        // Never let git/ssh pop an interactive prompt: a missing or revoked
        // credential must fail fast (and be treated as denied) rather than
        // hang the editor waiting on input that will never come.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
        },
      },
      (err, _stdout, stderr) => {
        if (!err) {
          resolve({ granted: true });
          return;
        }
        const lastLine = (stderr || err.message || "git ls-remote failed")
          .trim()
          .split("\n")
          .at(-1);
        resolve({ granted: false, reason: lastLine });
      },
    );
    child.on("error", (e) => resolve({ granted: false, reason: e.message }));
  });
}
