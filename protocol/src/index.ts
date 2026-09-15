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

/** Which side of a shared diff a comment thread is anchored to. */
export type DiffSide = "before" | "after";

/** Where a thread lives: one line on one side of one teammate's shared diff. */
export interface CommentAnchor {
  /** Id of the teammate whose diff this is. */
  ownerId: string;
  /** Repo-relative path within that diff. */
  path: string;
  side: DiffSide;
  /** Zero-based line number on that side. */
  line: number;
}

/** A single comment. Author and timestamp are stamped by the relay. */
export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** A thread of comments on a diff line. Lives as long as the room does. */
export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  comments: Comment[];
}

/**
 * Comment operations. `add` creates the thread when `threadId` is new, so
 * `anchor` is required then and ignored otherwise. Only the author may edit
 * or delete a comment; deleting the last comment removes its thread.
 */
export type CommentMessage =
  | {
      type: "comment";
      op: "add";
      threadId: string;
      commentId: string;
      body: string;
      anchor?: CommentAnchor;
    }
  | {
      type: "comment";
      op: "edit";
      threadId: string;
      commentId: string;
      body: string;
    }
  | { type: "comment"; op: "delete"; threadId: string; commentId: string };

/** Messages a client sends to the relay. */
export type ClientMessage =
  | { type: "hello"; id?: string; name: string; room: string }
  | { type: "update"; file?: string; branch?: string; status?: PresenceStatus }
  | { type: "diff"; files: DiffFile[] }
  | CommentMessage;

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

/** Comments broadcast: every thread in the room. */
export interface CommentsMessage {
  type: "comments";
  threads: CommentThread[];
}

/** Messages the relay sends to clients. */
export type ServerMessage = RosterMessage | DiffsMessage | CommentsMessage;
