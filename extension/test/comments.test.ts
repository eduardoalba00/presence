import { describe, expect, it } from "vitest";
import type { CommentAnchor, DiffFile } from "@presence/protocol";
import { anchorAvailable } from "../src/ui/comments";

const anchor: CommentAnchor = {
  ownerId: "bob",
  path: "src/a.ts",
  side: "after",
  line: 3,
};

function diffs(files: DiffFile[]): Map<string, DiffFile[]> {
  return new Map([["bob", files]]);
}

describe("anchorAvailable", () => {
  it("is true when the owner still shares that file", () => {
    const shared = diffs([
      { path: "src/a.ts", status: "modified", before: "", after: "" },
    ]);
    const sharedOk = anchorAvailable(anchor, shared);
    expect(sharedOk).toBe(true);
  });

  it("is false when the owner is gone or the file left their diff", () => {
    const emptyOk = anchorAvailable(anchor, new Map());
    expect(emptyOk).toBe(false);
    const other = diffs([
      { path: "src/b.ts", status: "modified", before: "", after: "" },
    ]);
    const otherOk = anchorAvailable(anchor, other);
    expect(otherOk).toBe(false);
  });

  it("is false for files whose content is not shipped", () => {
    const binary = diffs([
      { path: "src/a.ts", status: "binary", before: "", after: "" },
    ]);
    const binaryOk = anchorAvailable(anchor, binary);
    expect(binaryOk).toBe(false);
    const large = diffs([
      { path: "src/a.ts", status: "large", before: "", after: "" },
    ]);
    const largeOk = anchorAvailable(anchor, large);
    expect(largeOk).toBe(false);
  });
});
