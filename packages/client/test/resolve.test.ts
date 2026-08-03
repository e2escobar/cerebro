import { beforeEach, describe, expect, test } from "bun:test";
import {
  FlagNotFoundError,
  FlagTypeError,
  resetWarnings,
  resolveFlag,
  type FlagManifest,
} from "../src/index";

/** The read ladder. Every step, and the order between them. */

const manifest: FlagManifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T00:00:00.000Z",
  flags: {
    "new-checkout": { type: "boolean", default: false },
    "max-cart-items": { type: "number", default: 20 },
  },
};

beforeEach(() => {
  resetWarnings();
});

describe("resolveFlag", () => {
  test("prefers the live value", () => {
    const value = resolveFlag(
      { values: { "max-cart-items": 50 }, manifest, defaults: { "max-cart-items": 5 }, strict: "throw" },
      "max-cart-items",
      [99],
    );

    expect(value).toBe(50);
  });

  test("falls to the local default, then the manifest default, then the fallback", () => {
    const base = { values: {}, manifest, strict: "throw" } as const;

    expect(resolveFlag({ ...base, defaults: { "max-cart-items": 5 } }, "max-cart-items")).toBe(5);
    expect(resolveFlag(base, "max-cart-items")).toBe(20);
    expect(resolveFlag({ values: {}, strict: "throw" }, "anything", [7])).toBe(7);
  });

  test("the manifest default beats the call-site fallback", () => {
    // The manifest default is what the server itself serves when the flag is
    // off, so it is a better answer than a literal typed at the call site.
    expect(resolveFlag({ values: {}, manifest, strict: "throw" }, "max-cart-items", [99])).toBe(20);
  });

  test("a falsy live value is a value, not an absence", () => {
    expect(
      resolveFlag({ values: { "new-checkout": false }, manifest, strict: "throw" }, "new-checkout", [
        true,
      ]),
    ).toBe(false);
  });

  test("throws for a flag nobody has an answer for", () => {
    expect(() => resolveFlag({ values: {}, strict: "throw" }, "not-promoted-here")).toThrow(
      FlagNotFoundError,
    );
  });

  describe("a value of the wrong type", () => {
    const values = { "max-cart-items": "fifty" };

    test("throws in development", () => {
      expect(() => resolveFlag({ values, manifest, strict: "throw" }, "max-cart-items")).toThrow(
        FlagTypeError,
      );
    });

    test("falls through to the default in production", () => {
      expect(resolveFlag({ values, manifest, strict: "warn" }, "max-cart-items")).toBe(20);
    });

    test("is handed back untouched when validation is off", () => {
      expect(resolveFlag({ values, manifest, strict: "off" }, "max-cart-items")).toBe("fifty");
    });

    test("explains itself rather than claiming the flag is absent", () => {
      // No manifest default to fall back on, so the read has to fail — and the
      // useful error is "wrong type", not "not promoted here".
      let caught: unknown;
      try {
        resolveFlag(
          {
            values: {},
            invalid: { "max-cart-items": { key: "max-cart-items", expected: "number", received: "string" } },
            strict: "warn",
          },
          "max-cart-items",
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(FlagTypeError);
      expect((caught as FlagTypeError).expected).toBe("number");
    });
  });

  test("without a manifest it is exactly the old behaviour", () => {
    expect(resolveFlag({ values: { a: 1 }, strict: "throw" }, "a")).toBe(1);
    expect(resolveFlag({ values: {}, strict: "throw" }, "a", ["fallback"])).toBe("fallback");
    expect(() => resolveFlag({ values: {}, strict: "throw" }, "a")).toThrow(FlagNotFoundError);
  });
});
