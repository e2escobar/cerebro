import { describe, expect, test } from "bun:test";
import { hasIssues, matchesType, validateSnapshot, type FlagManifest } from "../src/index";

/**
 * `matchesType` is a second implementation of a rule that already exists in
 * `packages/core/src/flag-value.ts`. The two have to agree exactly, or the
 * client rejects values the server considers legal — so the interesting cases
 * here are the edges that Zod's `z.number().finite()` and `z.unknown()` decide.
 */

const manifest: FlagManifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T00:00:00.000Z",
  flags: {
    "new-checkout": { type: "boolean", default: false },
    "max-cart-items": { type: "number", default: 20 },
    "banner-copy": { type: "string", default: "" },
    "pricing-rules": { type: "json", default: null },
  },
};

describe("matchesType", () => {
  test("accepts the declared type and nothing else", () => {
    expect(matchesType("boolean", true)).toBe(true);
    expect(matchesType("boolean", "true")).toBe(false);
    expect(matchesType("boolean", 1)).toBe(false);

    expect(matchesType("string", "")).toBe(true);
    expect(matchesType("string", 0)).toBe(false);

    expect(matchesType("number", 0)).toBe(true);
    expect(matchesType("number", -1.5)).toBe(true);
    expect(matchesType("number", "5")).toBe(false);
  });

  test("rejects non-finite numbers, as z.number().finite() does server-side", () => {
    expect(matchesType("number", Number.NaN)).toBe(false);
    expect(matchesType("number", Number.POSITIVE_INFINITY)).toBe(false);
    expect(matchesType("number", Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  test("json takes any value that survived JSON, including null", () => {
    expect(matchesType("json", null)).toBe(true);
    expect(matchesType("json", { tiers: [1, 2] })).toBe(true);
    expect(matchesType("json", [])).toBe(true);
    expect(matchesType("json", "a string is valid json")).toBe(true);
    // The one thing JSON cannot represent, and the one z.unknown() lets through.
    expect(matchesType("json", undefined)).toBe(false);
  });
});

describe("validateSnapshot", () => {
  test("finds nothing wrong with a payload that matches", () => {
    const issues = validateSnapshot(
      { "new-checkout": true, "max-cart-items": 50, "banner-copy": "hi", "pricing-rules": {} },
      manifest,
    );

    expect(hasIssues(issues)).toBe(false);
  });

  test("separates a stale manifest from an unpromoted flag from a wrong type", () => {
    const issues = validateSnapshot(
      {
        "new-checkout": "yes", // wrong type
        "max-cart-items": 50,
        "banner-copy": "hi",
        "pricing-rules": null,
        "legacy-flag": 1, // not in the manifest
        // "nothing missing" — every manifest key above is present
      },
      manifest,
    );

    expect(issues.unknownKeys).toEqual(["legacy-flag"]);
    expect(issues.missingKeys).toEqual([]);
    expect(issues.typeMismatches).toEqual([
      { key: "new-checkout", expected: "boolean", received: "string" },
    ]);
  });

  test("a flag that is not promoted here is missing, not an error", () => {
    const issues = validateSnapshot({ "new-checkout": true }, manifest);

    expect(issues.missingKeys.sort()).toEqual(["banner-copy", "max-cart-items", "pricing-rules"]);
    expect(issues.typeMismatches).toEqual([]);
    expect(issues.unknownKeys).toEqual([]);
  });

  test("describes null as null rather than object, as the server does", () => {
    const issues = validateSnapshot({ "max-cart-items": null }, manifest);

    expect(issues.typeMismatches).toEqual([
      { key: "max-cart-items", expected: "number", received: "null" },
    ]);
  });
});
