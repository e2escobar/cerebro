import { z } from "zod";

/** Shared request/response schemas (spec §2, §7). Imported by api and web. */

export const FLAG_KEY = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,63}$/, "Must be lowercase letters, digits and dashes");
export const ENVIRONMENT_KEY = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, "Must be lowercase letters, digits and dashes");

/**
 * Deliberately laxer than `z.string().email()`: this is a self-hosted,
 * single-organization service where intranet addresses like `admin@local`
 * are normal — and the spec seeds exactly that.
 */
export const EMAIL = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+$/, "Must be an email address");

export const APPLICATION_KEY = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, "Must be lowercase letters, digits and dashes");

export const flagTypeSchema = z.enum(["boolean", "string", "number", "json"]);
export const userRoleSchema = z.enum(["admin", "developer"]);
export const envPermissionSchema = z.enum(["read", "write", "toggle", "promote"]);
export const apiKeyKindSchema = z.enum(["server", "client"]);
export const flagStateSchema = z.enum(["not_promoted", "promoted"]);

export type FlagTypeInput = z.infer<typeof flagTypeSchema>;
export type EnvPermissionInput = z.infer<typeof envPermissionSchema>;

/* ---------------------------------------------------------------- auth --- */

export const loginRequest = z.object({
  email: EMAIL,
  password: z.string().min(1),
});

/* --------------------------------------------------------------- flags --- */

export const createFlagRequest = z.object({
  key: FLAG_KEY,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: flagTypeSchema,
  defaultValue: z.unknown(),
  isClientSafe: z.boolean().optional(),
  initialValue: z.unknown().optional(),
});

export const updateFlagRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    isClientSafe: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "No fields to update" });

export const setValueRequest = z.object({ value: z.unknown() });
export const setEnabledRequest = z.object({ enabled: z.boolean() });

export const listFlagsQuery = z.object({
  q: z.string().optional(),
  type: flagTypeSchema.optional(),
  environment: ENVIRONMENT_KEY.optional(),
  state: flagStateSchema.optional(),
  archived: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/* -------------------------------------------------------- applications --- */

export const createApplicationRequest = z.object({
  key: APPLICATION_KEY,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const updateApplicationRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "No fields to update" });

/* -------------------------------------------------------- environments --- */

export const createEnvironmentRequest = z.object({
  key: ENVIRONMENT_KEY,
  name: z.string().min(1).max(200),
  rank: z.number().int().min(0),
  isProtected: z.boolean().optional(),
});

export const updateEnvironmentRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    isProtected: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "No fields to update" });

export const reorderEnvironmentsRequest = z.object({
  order: z.array(ENVIRONMENT_KEY).min(1),
});

/* ------------------------------------------------------------ api keys --- */

export const createApiKeyRequest = z.object({
  applicationKey: APPLICATION_KEY,
  environmentKey: ENVIRONMENT_KEY,
  name: z.string().min(1).max(200),
  kind: apiKeyKindSchema,
});

/* --------------------------------------------------- users, permissions --- */

export const createUserRequest = z.object({
  email: EMAIL,
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
  role: userRoleSchema.optional(),
});

export const updateUserRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    role: userRoleSchema.optional(),
    disabled: z.boolean().optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "No fields to update" });

export const setPermissionsRequest = z.object({
  grants: z.array(
    z.object({
      environmentKey: ENVIRONMENT_KEY,
      permissions: z.array(envPermissionSchema),
    }),
  ),
});

/* --------------------------------------------------------------- audit --- */

export const listAuditQuery = z.object({
  application: APPLICATION_KEY.optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  environmentKey: ENVIRONMENT_KEY.optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/* ----------------------------------------------------------- responses --- */

export interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export interface UserSummary {
  id: string;
  name: string;
}

export interface FlagEnvironmentView {
  key: string;
  name: string;
  rank: number;
  state: "not_promoted" | "promoted";
  enabled: boolean;
  value: unknown;
  isProtected: boolean;
  promotedAt: string | null;
  firstEnabledAt: string | null;
  updatedBy: UserSummary | null;
  updatedAt: string;
  canPromote: boolean;
  canToggle: boolean;
  canWrite: boolean;
}

export interface FlagDetail {
  applicationKey: string;
  key: string;
  name: string;
  description: string;
  type: FlagTypeInput;
  defaultValue: unknown;
  isClientSafe: boolean;
  archivedAt: string | null;
  createdBy: UserSummary | null;
  createdAt: string;
  updatedAt: string;
  environments: FlagEnvironmentView[];
  promotions: {
    fromEnv: string | null;
    toEnv: string | null;
    actor: string | null;
    createdAt: string;
  }[];
  /** Most recent mutations to this flag, newest first. */
  recentAudit: {
    id: string;
    action: string;
    environmentKey: string | null;
    actor: string | null;
    createdAt: string;
  }[];
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** One cell of the flag matrix. */
export interface FlagMatrixCell {
  key: string;
  rank: number;
  state: "not_promoted" | "promoted";
  enabled: boolean;
  value: unknown;
  updatedAt: string;
}

export interface FlagListItem {
  applicationKey: string;
  key: string;
  name: string;
  description: string;
  type: FlagTypeInput;
  defaultValue: unknown;
  isClientSafe: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  environments: FlagMatrixCell[];
}

export interface ApplicationSummary {
  key: string;
  name: string;
  description: string;
  archivedAt: string | null;
  createdAt: string;
  /** How many active flags it owns — shown in the switcher. */
  flagCount: number;
}

export interface EnvironmentSummary {
  key: string;
  name: string;
  rank: number;
  isProtected: boolean;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  kind: "server" | "client";
  prefix: string;
  applicationKey: string;
  environmentKey: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Only ever returned by `POST /v1/mgmt/api-keys`, and only once. */
export interface CreatedApiKey extends Omit<ApiKeySummary, "lastUsedAt" | "revokedAt"> {
  key: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "admin" | "developer";
  disabledAt: string | null;
  createdAt: string;
}

export interface PermissionGrant {
  environmentKey: string;
  permissions: EnvPermissionInput[];
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: "admin" | "developer";
  permissions: PermissionGrant[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  environmentKey: string | null;
  applicationKey: string | null;
  actor: { id: string; name: string | null } | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}
