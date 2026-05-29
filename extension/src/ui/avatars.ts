import * as vscode from "vscode";
import type { PresenceStatus } from "@presence/protocol";
import { initialsOf } from "../util/text";

/**
 * Produces a circular initials avatar (per name + status) as an SVG **data URI**
 * for use as a tree-item icon. Data URIs render reliably as tree icons; on-disk
 * SVGs are cached by path and often fail to paint, so we avoid them entirely.
 * Base64 encoding sidesteps URI-escaping pitfalls (notably `#` in colors).
 */
export class AvatarCache {
  private readonly cache = new Map<string, vscode.Uri>();

  iconFor(name: string, status: PresenceStatus): vscode.Uri {
    const initials = initialsOf(name);
    const color = colorOf(name);
    const key = `${color}-${initials}-${status}`;
    let uri = this.cache.get(key);
    if (!uri) {
      const svg = renderAvatarSvg(initials, color, status);
      const base64 = Buffer.from(svg, "utf8").toString("base64");
      uri = vscode.Uri.parse(`data:image/svg+xml;base64,${base64}`);
      this.cache.set(key, uri);
    }
    return uri;
  }
}

const PALETTE = [
  "#e2504a",
  "#e08e3c",
  "#d9b03a",
  "#5aa45a",
  "#3c9fb0",
  "#4f7fd0",
  "#8a5cd0",
  "#c062a8",
];

/** Presence-dot colors for the avatar corner. */
const STATUS_DOT: Record<PresenceStatus, string> = {
  active: "#3fb950", // green
  idle: "#d29922", // amber
};

/** Stable color choice for a name (same hash on every machine). */
function colorOf(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function renderAvatarSvg(
  initials: string,
  color: string,
  status: PresenceStatus,
): string {
  const fontSize = initials.length > 1 ? 42 : 52;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="50" fill="${color}"/>` +
    `<text x="50" y="50" dy="0.35em" text-anchor="middle" ` +
    `font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" ` +
    `font-size="${fontSize}" font-weight="600" fill="#ffffff">${initials}</text>` +
    // Presence dot, bottom-right, with a ring so it reads against any background.
    `<circle cx="78" cy="78" r="20" fill="#1e1e1e"/>` +
    `<circle cx="78" cy="78" r="15" fill="${STATUS_DOT[status]}"/>` +
    `</svg>`
  );
}
