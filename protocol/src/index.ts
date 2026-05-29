/**
 * The WebSocket wire contract shared by the relay server and the VS Code
 * extension. This is the single source of truth for every message exchanged;
 * the relay itself treats payloads as opaque and only stores + echoes them.
 */

/** Whether a teammate is actively working or has gone idle. */
export type PresenceStatus = "active" | "idle";

/** A teammate as seen in a room roster. */
export interface User {
  id: string;
  name: string;
  /** Workspace-relative path of their active file ("" when none). */
  file: string;
  /** Current git branch ("" when unknown or no repo). */
  branch: string;
  status: PresenceStatus;
}

/** The kind of uncommitted change to a file. */
export type DiffStatus =
  | "added"
  | "modified"
  | "deleted"
  | "untracked"
  | "binary"
  | "large";

/**
 * One uncommitted file change. Both sides are carried inline so a teammate's
 * diff can be rendered without access to their working tree. `before`/`after`
 * are intentionally empty for `binary`/`large` files (not shipped).
 */
export interface DiffFile {
  /** Repo-relative path, forward slashes. */
  path: string;
  status: DiffStatus;
  /** HEAD content ("" when added/untracked). */
  before: string;
  /** Working-tree content ("" when deleted). */
  after: string;
}

/** A single member's set of uncommitted changes. */
export interface DiffEntry {
  id: string;
  files: DiffFile[];
}

/** Messages a client sends to the relay. */
export type ClientMessage =
  | { type: "hello"; id?: string; name: string; room: string }
  | { type: "update"; file?: string; branch?: string; status?: PresenceStatus }
  | { type: "diff"; files: DiffFile[] };

/** Roster broadcast: everyone currently in the room. */
export interface RosterMessage {
  type: "roster";
  users: User[];
}

/** Diffs broadcast: each member's current uncommitted changes. */
export interface DiffsMessage {
  type: "diffs";
  entries: DiffEntry[];
}

/** Messages the relay sends to clients. */
export type ServerMessage = RosterMessage | DiffsMessage;
