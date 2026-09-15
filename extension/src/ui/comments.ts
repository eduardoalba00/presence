import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type {
  Comment,
  CommentAnchor,
  CommentMessage,
  CommentThread,
  DiffFile,
} from "@presence/protocol";
import {
  COMMENT_CANCEL_COMMAND,
  COMMENT_CONTROLLER_ID,
  COMMENT_DELETE_COMMAND,
  COMMENT_EDIT_COMMAND,
  COMMENT_REPLY_COMMAND,
  COMMENT_SAVE_COMMAND,
  DIFF_SCHEME,
} from "../constants";
import { diffUri, parseDiffUri } from "./diffViewer";

/** `contextValue` on comments we authored; drives the edit/delete menus. */
const MINE = "mine";

/** A rendered comment. Carries the ids the edit/delete commands need. */
class PresenceComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  body: string | vscode.MarkdownString;
  /** Last body confirmed by the relay; restored when an edit is cancelled. */
  savedBody: string;
  readonly author: vscode.CommentAuthorInformation;
  readonly timestamp: Date;
  readonly contextValue: string | undefined;

  constructor(
    readonly id: string,
    readonly threadId: string,
    source: Comment,
    mine: boolean,
  ) {
    this.body = source.body;
    this.savedBody = source.body;
    this.author = { name: source.authorName };
    this.timestamp = new Date(source.createdAt);
    this.contextValue = mine ? MINE : undefined;
  }
}

/** True when the owner's shared diff still contains the anchored file. */
export function anchorAvailable(
  anchor: CommentAnchor,
  diffsByUser: Map<string, DiffFile[]>,
): boolean {
  const files = diffsByUser.get(anchor.ownerId) ?? [];
  const file = files.find((f) => f.path === anchor.path);
  if (!file) return false;
  return file.status !== "binary" && file.status !== "large";
}

/**
 * Mirrors the room's comment threads onto VS Code comment threads in the diff
 * editor, and turns the reply/edit/delete UI into relay ops. Threads are
 * rebuilt from every broadcast; only those whose diff is still shared render.
 */
export class CommentSync implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly threads = new Map<string, vscode.CommentThread>();
  /** Threads we created locally that the relay hasn't echoed back yet. */
  private readonly pending = new Set<string>();
  private serverThreads: CommentThread[] = [];
  private diffsByUser = new Map<string, DiffFile[]>();

  constructor(
    private readonly myId: string,
    private readonly send: (msg: CommentMessage) => void,
  ) {
    this.controller = vscode.comments.createCommentController(
      COMMENT_CONTROLLER_ID,
      "Presence",
    );
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (doc) => commentableRanges(doc),
    };
    this.controller.options = {
      prompt: "Comment on this change",
      placeHolder: "Leave a comment for your teammate…",
    };
    const reply = vscode.commands.registerCommand(
      COMMENT_REPLY_COMMAND,
      (r: vscode.CommentReply) => this.reply(r),
    );
    const edit = vscode.commands.registerCommand(
      COMMENT_EDIT_COMMAND,
      (c: PresenceComment) => this.startEdit(c),
    );
    const save = vscode.commands.registerCommand(
      COMMENT_SAVE_COMMAND,
      (c: PresenceComment) => this.saveEdit(c),
    );
    const cancel = vscode.commands.registerCommand(
      COMMENT_CANCEL_COMMAND,
      (c: PresenceComment) => this.cancelEdit(c),
    );
    const remove = vscode.commands.registerCommand(
      COMMENT_DELETE_COMMAND,
      (c: PresenceComment) => this.remove(c),
    );
    this.disposables.push(this.controller, reply, edit, save, cancel, remove);
  }

  setThreads(threads: CommentThread[]): void {
    this.serverThreads = threads;
    this.render();
  }

  setDiffs(diffsByUser: Map<string, DiffFile[]>): void {
    this.diffsByUser = diffsByUser;
    this.render();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  /** Reconcile local threads with the latest server state. */
  private render(): void {
    const seen = new Set<string>();
    for (const source of this.serverThreads) {
      seen.add(source.id);
      this.pending.delete(source.id);
      const available = anchorAvailable(source.anchor, this.diffsByUser);
      if (available) this.upsert(source);
      else seen.delete(source.id);
    }
    for (const [id, thread] of this.threads) {
      if (seen.has(id) || this.pending.has(id)) continue;
      thread.dispose();
      this.threads.delete(id);
    }
  }

  private upsert(source: CommentThread): void {
    let thread = this.threads.get(source.id);
    if (!thread) {
      const { ownerId, path, side, line } = source.anchor;
      const uri = diffUri(ownerId, path, side);
      const range = new vscode.Range(line, 0, line, 0);
      thread = this.controller.createCommentThread(uri, range, []);
      thread.canReply = true;
      this.threads.set(source.id, thread);
    }
    // Don't yank a comment out from under someone mid-edit; the thread is
    // re-rendered once they save or cancel.
    const editing = isEditing(thread);
    if (editing) return;
    thread.comments = source.comments.map(
      (c) => new PresenceComment(c.id, source.id, c, c.authorId === this.myId),
    );
  }

  // --- commands ------------------------------------------------------------

  private reply(reply: vscode.CommentReply): void {
    const body = reply.text.trim();
    if (!body) return;
    const { thread } = reply;
    let threadId = this.idOf(thread);
    let anchor: CommentAnchor | undefined;
    if (!threadId) {
      anchor = anchorOf(thread);
      if (!anchor) return;
      threadId = randomUUID();
      this.threads.set(threadId, thread);
      this.pending.add(threadId);
    }
    const commentId = randomUUID();
    this.send({
      type: "comment",
      op: "add",
      threadId,
      commentId,
      body,
      anchor,
    });
  }

  private startEdit(comment: PresenceComment): void {
    const live = this.liveComment(comment);
    if (!live) return;
    live.mode = vscode.CommentMode.Editing;
    this.refresh(live.threadId);
  }

  private saveEdit(comment: PresenceComment): void {
    const live = this.liveComment(comment);
    if (!live) return;
    const body = bodyText(comment.body).trim();
    live.mode = vscode.CommentMode.Preview;
    if (!body || body === live.savedBody) {
      live.body = live.savedBody;
      this.render();
      return;
    }
    live.body = body;
    this.refresh(live.threadId);
    this.send({
      type: "comment",
      op: "edit",
      threadId: live.threadId,
      commentId: live.id,
      body,
    });
  }

  private cancelEdit(comment: PresenceComment): void {
    const live = this.liveComment(comment);
    if (!live) return;
    live.mode = vscode.CommentMode.Preview;
    live.body = live.savedBody;
    this.render();
  }

  private remove(comment: PresenceComment): void {
    this.send({
      type: "comment",
      op: "delete",
      threadId: comment.threadId,
      commentId: comment.id,
    });
  }

  // --- helpers -------------------------------------------------------------

  private idOf(thread: vscode.CommentThread): string | undefined {
    for (const [id, t] of this.threads) if (t === thread) return id;
    return undefined;
  }

  /** The comment instance VS Code renders (command args may be copies). */
  private liveComment(comment: PresenceComment): PresenceComment | undefined {
    const thread = this.threads.get(comment.threadId);
    const found = thread?.comments.find((c) => {
      const pc = c as PresenceComment;
      return pc.id === comment.id;
    });
    return found as PresenceComment | undefined;
  }

  /** Reassign the comments array so VS Code repaints the thread. */
  private refresh(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (thread) thread.comments = [...thread.comments];
  }
}

function isEditing(thread: vscode.CommentThread): boolean {
  return thread.comments.some((c) => c.mode === vscode.CommentMode.Editing);
}

function bodyText(body: string | vscode.MarkdownString): string {
  return typeof body === "string" ? body : body.value;
}

/** Only our diff documents accept comments; every line of them does. */
function commentableRanges(doc: vscode.TextDocument): vscode.Range[] {
  if (doc.uri.scheme !== DIFF_SCHEME) return [];
  const lastLine = Math.max(doc.lineCount - 1, 0);
  return [new vscode.Range(0, 0, lastLine, 0)];
}

/** Where a locally-created thread sits, in wire terms. */
function anchorOf(thread: vscode.CommentThread): CommentAnchor | undefined {
  const parsed = parseDiffUri(thread.uri);
  if (!parsed || !thread.range) return undefined;
  return { ...parsed, line: thread.range.start.line };
}
