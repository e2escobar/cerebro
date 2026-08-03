import { describe, expect, test } from "bun:test";
import { MAX_JSON_VALUE_BYTES, validateValue } from "../src/flag-value.ts";
import { DomainError } from "../src/errors.ts";

/** Spec §5.1 — one validator, four types, positive and negative each. */

describe("validateValue", () => {
  test("boolean accepts booleans and rejects everything else", () => {
    expect(validateValue("boolean", true)).toBe(true);
    expect(validateValue("boolean", false)).toBe(false);
    expect(() => validateValue("boolean", "true")).toThrow(DomainError);
    expect(() => validateValue("boolean", 1)).toThrow(DomainError);
  });

  test("string accepts strings and rejects everything else", () => {
    expect(validateValue("string", "Summer sale")).toBe("Summer sale");
    expect(validateValue("string", "")).toBe("");
    expect(() => validateValue("string", 42)).toThrow(DomainError);
    expect(() => validateValue("string", null)).toThrow(DomainError);
  });

  test("number accepts finite numbers and rejects NaN, Infinity and strings", () => {
    expect(validateValue("number", 50)).toBe(50);
    expect(validateValue("number", -0.5)).toBe(-0.5);
    expect(() => validateValue("number", Number.NaN)).toThrow(DomainError);
    expect(() => validateValue("number", Number.POSITIVE_INFINITY)).toThrow(DomainError);
    expect(() => validateValue("number", "50")).toThrow(DomainError);
  });

  test("json accepts any structure under the size ceiling", () => {
    expect(validateValue("json", { tier: "b", discount: 0.1 })).toEqual({
      tier: "b",
      discount: 0.1,
    });
    expect(validateValue("json", [1, 2, 3])).toEqual([1, 2, 3]);
  });

  test("json rejects a value that serializes above 32 KB", () => {
    const oversized = { blob: "x".repeat(MAX_JSON_VALUE_BYTES + 1) };
    expect(() => validateValue("json", oversized)).toThrow(DomainError);
    try {
      validateValue("json", oversized);
    } catch (error) {
      expect((error as DomainError).code).toBe("INVALID_FLAG_VALUE");
    }
  });

  test("errors carry the stable INVALID_FLAG_VALUE code", () => {
    try {
      validateValue("number", "nope");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("INVALID_FLAG_VALUE");
    }
  });
});
