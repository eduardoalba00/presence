import { describe, expect, it } from "vitest";
import type { CommentAnchor, CommentMessage } from "@presence/protocol";
import {
  applyCommentOp,
  MAX_COMMENT_CHARS,
  type CommentStore,
} from "../src/comments";

const alice = { id: "a1", name: "Alice" };
const bob = { id: "b2", name: "Bob" };
const anchor: CommentAnchor = {
  ownerId: bob.id,
  path: "src/index.ts",
  side: "after",
  line: 4,
};

function add(
  threadId: string,
  commentId: string,
  body: string,
  withAnchor: CommentAnchor = anchor,
): CommentMessage {
  return {
    type: "comment",
    op: "add",
    threadId,
    commentId,
    body,
    anchor: withAnchor,
  };
}

function seeded(): CommentStore {
  const store: CommentStore = new Map();
  const first = add("t1", "c1", "looks wrong");
  applyCommentOp(store, alice, first);
  return store;
}

describe("applyCommentOp add", () => {
  it("creates a thread stamped with author and time", () => {
    const store = seeded();
    const thread = store.get("t1");
    expect(thread?.anchor).toEqual(anchor);
    expect(thread?.comments).toHaveLength(1);
    const comment = thread?.comments[0];
    expect(comment).toMatchObject({
      id: "c1",
      authorId: "a1",
      authorName: "Alice",
      body: "looks wrong",
    });
    expect(typeof comment?.createdAt).toBe("number");
  });

  it("appends to an existing thread and ignores a new anchor", () => {
    const store = seeded();
    const other: CommentAnchor = { ...anchor, line: 99 };
    const reply = add("t1", "c2", "agreed", other);
    const changed = applyCommentOp(store, bob, reply);
    expect(changed).toBe(true);
    const thread = store.get("t1");
    expect(thread?.anchor).toEqual(anchor);
    const ids = thread?.comments.map((c) => c.id);
    expect(ids).toEqual(["c1", "c2"]);
  });

  it("requires a valid anchor for a new thread", () => {
    const store: CommentStore = new Map();
    const noAnchor: CommentMessage = {
      type: "comment",
      op: "add",
      threadId: "t1",
      commentId: "c1",
      body: "hi",
    };
    expect(applyCommentOp(store, alice, noAnchor)).toBe(false);
    const badLine = add("t1", "c1", "hi", { ...anchor, line: -1 });
    expect(applyCommentOp(store, alice, badLine)).toBe(false);
    const badSide = { ...anchor, side: "middle" } as unknown as CommentAnchor;
    const badSideMsg = add("t1", "c1", "hi", badSide);
    expect(applyCommentOp(store, alice, badSideMsg)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("rejects blank, oversized, and non-string bodies", () => {
    const store: CommentStore = new Map();
    const blank = add("t1", "c1", "   ");
    expect(applyCommentOp(store, alice, blank)).toBe(false);
    const huge = add("t1", "c1", "x".repeat(MAX_COMMENT_CHARS + 1));
    expect(applyCommentOp(store, alice, huge)).toBe(false);
    const notString = add("t1", "c1", 42 as unknown as string);
    expect(applyCommentOp(store, alice, notString)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("trims the body", () => {
    const store: CommentStore = new Map();
    const padded = add("t1", "c1", "  hello \n");
    applyCommentOp(store, alice, padded);
    expect(store.get("t1")?.comments[0].body).toBe("hello");
  });

  it("rejects a duplicate comment id within a thread", () => {
    const store = seeded();
    const dup = add("t1", "c1", "again");
    expect(applyCommentOp(store, alice, dup)).toBe(false);
    expect(store.get("t1")?.comments).toHaveLength(1);
  });

  it("rejects empty ids", () => {
    const store: CommentStore = new Map();
    const noThread = add("", "c1", "hi");
    expect(applyCommentOp(store, alice, noThread)).toBe(false);
    const noComment = add("t1", "", "hi");
    expect(applyCommentOp(store, alice, noComment)).toBe(false);
  });
});

describe("applyCommentOp edit", () => {
  it("lets the author change the body", () => {
    const store = seeded();
    const edit: CommentMessage = {
      type: "comment",
      op: "edit",
      threadId: "t1",
      commentId: "c1",
      body: "never mind",
    };
    expect(applyCommentOp(store, alice, edit)).toBe(true);
    expect(store.get("t1")?.comments[0].body).toBe("never mind");
  });

  it("refuses edits from anyone else", () => {
    const store = seeded();
    const edit: CommentMessage = {
      type: "comment",
      op: "edit",
      threadId: "t1",
      commentId: "c1",
      body: "hijacked",
    };
    expect(applyCommentOp(store, bob, edit)).toBe(false);
    expect(store.get("t1")?.comments[0].body).toBe("looks wrong");
  });

  it("ignores unknown threads and comments", () => {
    const store = seeded();
    const missingThread: CommentMessage = {
      type: "comment",
      op: "edit",
      threadId: "nope",
      commentId: "c1",
      body: "x",
    };
    expect(applyCommentOp(store, alice, missingThread)).toBe(false);
    const missingComment: CommentMessage = {
      type: "comment",
      op: "edit",
      threadId: "t1",
      commentId: "nope",
      body: "x",
    };
    expect(applyCommentOp(store, alice, missingComment)).toBe(false);
  });
});

describe("applyCommentOp delete", () => {
  it("removes the comment and drops an emptied thread", () => {
    const store = seeded();
    const del: CommentMessage = {
      type: "comment",
      op: "delete",
      threadId: "t1",
      commentId: "c1",
    };
    expect(applyCommentOp(store, alice, del)).toBe(true);
    expect(store.has("t1")).toBe(false);
  });

  it("keeps the thread when other comments remain", () => {
    const store = seeded();
    const reply = add("t1", "c2", "reply");
    applyCommentOp(store, bob, reply);
    const del: CommentMessage = {
      type: "comment",
      op: "delete",
      threadId: "t1",
      commentId: "c1",
    };
    applyCommentOp(store, alice, del);
    const ids = store.get("t1")?.comments.map((c) => c.id);
    expect(ids).toEqual(["c2"]);
  });

  it("refuses deletes from anyone but the author", () => {
    const store = seeded();
    const del: CommentMessage = {
      type: "comment",
      op: "delete",
      threadId: "t1",
      commentId: "c1",
    };
    expect(applyCommentOp(store, bob, del)).toBe(false);
    expect(store.get("t1")?.comments).toHaveLength(1);
  });
});
