/**
 * Typed domain errors (spec §6). `code` is the stable contract: the HTTP layer
 * maps code → status and never branches on anything else.
 */

export type ErrorCode =
  // 400
  | "VALIDATION_FAILED"
  | "INVALID_FLAG_VALUE"
  // 401
  | "UNAUTHENTICATED"
  // 403
  | "FORBIDDEN"
  // 404
  | "FLAG_NOT_FOUND"
  | "ENVIRONMENT_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "API_KEY_NOT_FOUND"
  | "APPLICATION_NOT_FOUND"
  // 409
  | "FLAG_KEY_TAKEN"
  | "ENVIRONMENT_KEY_TAKEN"
  | "ENVIRONMENT_RANK_TAKEN"
  | "USER_EMAIL_TAKEN"
  | "APPLICATION_KEY_TAKEN"
  | "ALREADY_PROMOTED"
  | "NOT_PROMOTED"
  // 422
  | "FLAG_NOT_PROMOTABLE"
  | "FLAG_ARCHIVED"
  | "FLAG_NOT_ARCHIVED"
  | "CANNOT_PROMOTE_INTO_BASE_ENVIRONMENT"
  | "PROMOTED_IN_HIGHER_ENVIRONMENT"
  | "ENVIRONMENT_IN_USE"
  | "APPLICATION_IN_USE"
  | "INVALID_ENVIRONMENT_ORDER"
  | "NO_BASE_ENVIRONMENT";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends DomainError {}
export class Unauthenticated extends DomainError {
  constructor(message = "Authentication required") {
    super("UNAUTHENTICATED", message);
  }
}
export class Forbidden extends DomainError {
  constructor(message = "You do not have permission to do that", details?: Record<string, unknown>) {
    super("FORBIDDEN", message, details);
  }
}
export class NotFound extends DomainError {}
export class Conflict extends DomainError {}
export class RuleViolation extends DomainError {}

/** code → HTTP status. The API's error handler is a lookup, not a switch. */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_FLAG_VALUE: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FLAG_NOT_FOUND: 404,
  ENVIRONMENT_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  API_KEY_NOT_FOUND: 404,
  APPLICATION_NOT_FOUND: 404,
  FLAG_KEY_TAKEN: 409,
  ENVIRONMENT_KEY_TAKEN: 409,
  ENVIRONMENT_RANK_TAKEN: 409,
  USER_EMAIL_TAKEN: 409,
  APPLICATION_KEY_TAKEN: 409,
  ALREADY_PROMOTED: 409,
  NOT_PROMOTED: 409,
  FLAG_NOT_PROMOTABLE: 422,
  FLAG_ARCHIVED: 422,
  FLAG_NOT_ARCHIVED: 422,
  CANNOT_PROMOTE_INTO_BASE_ENVIRONMENT: 422,
  PROMOTED_IN_HIGHER_ENVIRONMENT: 422,
  ENVIRONMENT_IN_USE: 422,
  APPLICATION_IN_USE: 422,
  INVALID_ENVIRONMENT_ORDER: 422,
  NO_BASE_ENVIRONMENT: 422,
};
