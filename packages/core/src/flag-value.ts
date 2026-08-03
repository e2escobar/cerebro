import type { FlagType, FlagValue } from "@cerebro/db";
import { z } from "zod";
import { ValidationError } from "./errors.ts";

/** Serialized ceiling for `json` flags (spec §5.1). */
export const MAX_JSON_VALUE_BYTES = 32 * 1024;

const VALIDATORS = {
  boolean: z.boolean(),
  string: z.string(),
  number: z.number().finite(),
  json: z.unknown(),
} as const satisfies Record<FlagType, z.ZodTypeAny>;

/**
 * The single value validator (spec §5.1). Runs on flag creation, value edits
 * and promotion — there is no second implementation anywhere.
 */
export function validateValue(type: FlagType, value: unknown): FlagValue {
  const result = VALIDATORS[type].safeParse(value);
  if (!result.success) {
    throw new ValidationError("INVALID_FLAG_VALUE", `Value must be a ${type}`, {
      type,
      received: value === null ? "null" : typeof value,
    });
  }

  if (type === "json") {
    if (value === undefined) {
      throw new ValidationError("INVALID_FLAG_VALUE", "Value must be valid JSON", { type });
    }
    const size = new TextEncoder().encode(JSON.stringify(value)).length;
    if (size > MAX_JSON_VALUE_BYTES) {
      throw new ValidationError(
        "INVALID_FLAG_VALUE",
        `JSON value must serialize to at most ${MAX_JSON_VALUE_BYTES} bytes`,
        { type, size, max: MAX_JSON_VALUE_BYTES },
      );
    }
  }

  return result.data as FlagValue;
}

/** Type guard used when reading rows back out of the database. */
export function isFlagType(value: string): value is FlagType {
  return value in VALIDATORS;
}
