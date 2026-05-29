import { describe, expect, it } from "vitest";
import { hasNullByte, initialsOf } from "../src/util/text";

describe("initialsOf", () => {
  it("takes the first two alphanumerics, ignoring spaces and punctuation", () => {
    expect(initialsOf("Eduardo - A")).toBe("ED");
    expect(initialsOf("john_doe")).toBe("JO");
    expect(initialsOf("a")).toBe("A");
  });

  it("supports unicode letters and digits", () => {
    expect(initialsOf("Éloïse")).toBe("ÉL");
    expect(initialsOf("3M Company")).toBe("3M");
  });

  it("falls back to '?' when there is nothing alphanumeric", () => {
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("--")).toBe("?");
    expect(initialsOf("")).toBe("?");
  });
});

describe("hasNullByte", () => {
  const NUL = String.fromCharCode(0);

  it("detects an embedded NUL byte", () => {
    expect(hasNullByte(`abc${NUL}def`)).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(hasNullByte("hello world")).toBe(false);
    expect(hasNullByte("")).toBe(false);
  });
});
