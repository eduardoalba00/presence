import { describe, expect, it } from "vitest";
import { normalizeRemoteUrl } from "../src/config";

describe("normalizeRemoteUrl", () => {
  // The bug this fixes: HTTPS and SSH clones of one repo must collapse to a
  // single identity so teammates land in the same room regardless of protocol.
  it("maps every clone style of the same repo to one canonical id", () => {
    const variants = [
      "https://github.com/acme/widget.git",
      "https://github.com/acme/widget", // no .git suffix
      "https://github.com/acme/widget/", // trailing slash
      "http://github.com/acme/widget.git",
      "git@github.com:acme/widget.git", // scp-like
      "ssh://git@github.com/acme/widget.git",
      "ssh://git@github.com:22/acme/widget.git", // explicit port
      "git://github.com/acme/widget.git",
      "https://x-access-token:TOKEN@github.com/acme/widget.git", // embedded creds
    ];
    const ids = variants.map(normalizeRemoteUrl);
    for (const id of ids) {
      expect(id).toBe("github.com/acme/widget");
    }
  });

  it("lowercases the host but preserves the case of the path", () => {
    expect(normalizeRemoteUrl("git@GitHub.com:Acme/Widget.git")).toBe(
      "github.com/Acme/Widget",
    );
    expect(normalizeRemoteUrl("https://GITHUB.COM/Acme/Widget")).toBe(
      "github.com/Acme/Widget",
    );
  });

  it("keeps distinct repositories distinct", () => {
    expect(normalizeRemoteUrl("git@github.com:acme/widget.git")).not.toBe(
      normalizeRemoteUrl("git@github.com:acme/gadget.git"),
    );
    // Same path on a different host must not collide.
    expect(normalizeRemoteUrl("git@github.com:acme/widget.git")).not.toBe(
      normalizeRemoteUrl("git@gitlab.com:acme/widget.git"),
    );
  });

  it("handles self-hosted hosts and nested group paths", () => {
    expect(normalizeRemoteUrl("git@gitlab.example.com:team/sub/repo.git")).toBe(
      "gitlab.example.com/team/sub/repo",
    );
    expect(
      normalizeRemoteUrl("ssh://git@gitlab.example.com:2222/team/sub/repo.git"),
    ).toBe("gitlab.example.com/team/sub/repo");
  });

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeRemoteUrl("  git@github.com:acme/widget.git\n")).toBe(
      "github.com/acme/widget",
    );
  });

  it("falls back to a lowercased original for unrecognized input", () => {
    // No scheme and no scp-like colon: nothing to canonicalize, but it must
    // still be deterministic so the same input always hashes the same way.
    expect(normalizeRemoteUrl("Just-A-Folder-Name")).toBe("just-a-folder-name");
  });
});
