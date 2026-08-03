import type { ErrorBody } from "@cerebro/contracts";
import { DomainError, STATUS_BY_CODE } from "@cerebro/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

/**
 * The single place HTTP status is decided (spec §7). Handlers throw domain
 * errors; the status comes from `DomainError.code`, never from a branch here.
 */

export function errorBody(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorBody {
  return { error: { code, message, details } };
}

export function handleError(error: unknown, c: Context): Response {
  if (error instanceof DomainError) {
    const status = STATUS_BY_CODE[error.code] as ContentfulStatusCode;
    return c.json(errorBody(error.code, error.message, error.details), status);
  }

  if (error instanceof ZodError) {
    return c.json(
      errorBody("VALIDATION_FAILED", "Request validation failed", {
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      400,
    );
  }

  console.error("unexpected error:", error);
  return c.json(errorBody("INTERNAL_ERROR", "Something went wrong"), 500);
}
