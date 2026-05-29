import { describe, expect, it } from "vitest";
import { locationLabel, normalizePath } from "../src/util/paths";

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("src\\components\\Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });

  it("leaves already-posix paths untouched", () => {
    expect(normalizePath("src/components/Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });
});

describe("locationLabel", () => {
  it("shows filename first, then its folder", () => {
    expect(locationLabel("src/components/Button.tsx")).toBe(
      "Button.tsx · src/components",
    );
  });

  it("shows just the filename when at the workspace root", () => {
    expect(locationLabel("README.md")).toBe("README.md");
  });

  it("normalizes windows separators first", () => {
    expect(locationLabel("src\\ui\\statusBar.ts")).toBe(
      "statusBar.ts · src/ui",
    );
  });

  it("reports when no file is open", () => {
    expect(locationLabel("")).toBe("no file open");
  });
});
