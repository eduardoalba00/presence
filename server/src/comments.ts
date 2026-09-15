import type {
  Comment,
  CommentAnchor,
  CommentMessage,
  CommentThread,
} from "@presence/protocol";

/** Reject comment bodies longer than this (after trimming). */
export const MAX_COMMENT_CHARS = 10_000;

/** A room's comment threads, keyed by thread id. */
export type CommentStore = Map<string, CommentThread>;

export interface Author {
  id: string;
  name: string;
}

/**
 * Applies one client comment op to a room's store. Validates the payload and
 * enforces that only the author may edit or delete. Returns whether the store
 * changed, so the caller knows whether to broadcast.
 */
export function applyCommentOp(
  store: CommentStore,
  author: Author,
  msg: CommentMessage,
): boolean {
  const idsOk = isId(msg.threadId) && isId(msg.commentId);
  if (!idsOk) return false;
  switch (msg.op) {
    case "add":
      return addComment(store, author, msg);
    case "edit":
      return editComment(store, author, msg);
    case "delete":
      return deleteComment(store, author, msg);
    default:
      return false;
  }
}

function addComment(
  store: CommentStore,
  author: Author,
  msg: Extract<CommentMessage, { op: "add" }>,
): boolean {
  const body = cleanBody(msg.body);
  if (body === undefined) return false;

  let thread = store.get(msg.threadId);
  if (!thread) {
    thread = createThread(msg.threadId, msg.anchor);
    if (!thread) return false;
    store.set(thread.id, thread);
  }
  const existing = findComment(thread, msg.commentId);
  if (existing) return false;

  const comment: Comment = {
    id: msg.commentId,
    authorId: author.id,
    authorName: author.name,
    body,
    createdAt: Date.now(),
  };
  thread.comments.push(comment);
  return true;
}

function editComment(
  store: CommentStore,
  author: Author,
  msg: Extract<CommentMessage, { op: "edit" }>,
): boolean {
  const body = cleanBody(msg.body);
  if (body === undefined) return false;
  const thread = store.get(msg.threadId);
  if (!thread) return false;
  const comment = findComment(thread, msg.commentId);
  if (!comment || comment.authorId !== author.id) return false;
  comment.body = body;
  return true;
}

function deleteComment(
  store: CommentStore,
  author: Author,
  msg: Extract<CommentMessage, { op: "delete" }>,
): boolean {
  const thread = store.get(msg.threadId);
  if (!thread) return false;
  const index = thread.comments.findIndex((c) => c.id === msg.commentId);
  if (index === -1) return false;
  if (thread.comments[index].authorId !== author.id) return false;
  thread.comments.splice(index, 1);
  if (thread.comments.length === 0) store.delete(thread.id);
  return true;
}

/** A new, empty thread, or undefined when the anchor is malformed. */
function createThread(id: string, anchor: unknown): CommentThread | undefined {
  const anchorOk = isAnchor(anchor);
  if (!anchorOk) return undefined;
  return { id, anchor, comments: [] };
}

function findComment(
  thread: CommentThread,
  commentId: string,
): Comment | undefined {
  return thread.comments.find((c) => c.id === commentId);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Trimmed body, or undefined when empty, too long, or not a string. */
function cleanBody(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const body = value.trim();
  if (body.length === 0 || body.length > MAX_COMMENT_CHARS) return undefined;
  return body;
}

function isAnchor(value: unknown): value is CommentAnchor {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<CommentAnchor>;
  const sideOk = a.side === "before" || a.side === "after";
  const lineOk = Number.isInteger(a.line) && (a.line as number) >= 0;
  const ownerOk = isId(a.ownerId);
  const pathOk = isId(a.path);
  return ownerOk && pathOk && sideOk && lineOk;
}
