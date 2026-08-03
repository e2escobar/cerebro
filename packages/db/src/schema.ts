import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Authoritative data model (spec §4).
 *
 * Deviation from the spec's illustrative SQL: the enum for environment
 * permissions is named `env_permission_kind`, not `env_permission`. Postgres
 * puts types and tables in the same namespace — `CREATE TABLE env_permission`
 * implicitly creates a composite type of that name, so an enum with the same
 * name cannot coexist. The table keeps the spec's name.
 */

export const userRole = pgEnum("user_role", ["admin", "developer"]);
export const flagType = pgEnum("flag_type", ["boolean", "string", "number", "json"]);
export const flagEnvState = pgEnum("flag_env_state", ["not_promoted", "promoted"]);
export const envPermissionKind = pgEnum("env_permission_kind", [
  "read",
  "write",
  "toggle",
  "promote",
]);
export const apiKeyKind = pgEnum("api_key_kind", ["server", "client"]);

/** A flag value is any JSON — the declared `flag.type` narrows it. */
export type FlagValue = boolean | string | number | Record<string, unknown> | unknown[] | null;

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("developer"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const environment = pgTable("environment", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** `^[a-z][a-z0-9-]{1,31}$` — the public identifier in every route. */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  /** 0 = lowest = the environment flags are created in. */
  rank: integer("rank").notNull().unique(),
  isProtected: boolean("is_protected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An application owns its flags. Two applications may each have a flag called
 * `new-checkout`; they are unrelated flags with their own types, defaults and
 * per-environment state.
 *
 * Environments stay global — the promotion pipeline is an organization-wide
 * policy, not something each application redefines.
 */
export const application = pgTable("application", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** `^[a-z][a-z0-9-]{1,31}$` — the public identifier in every route. */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => appUser.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The payload version an application's SDK clients poll on, per environment
 * (spec §9). It lives here rather than on `environment` so one team's release
 * does not invalidate every other application's cached payload.
 */
export const applicationEnvironment = pgTable(
  "application_environment",
  {
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    configVersion: bigint("config_version", { mode: "number" }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.environmentId] })],
);

export const flag = pgTable(
  "flag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Deleting an application is refused while it still has active flags, so
    // this only ever cascades archived ones — deliberate, not accidental.
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    /** `^[a-z][a-z0-9-]{1,63}$` — unique within its application, not globally. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Immutable after creation (spec §5.1). */
    type: flagType("type").notNull(),
    /** Returned by the evaluation API whenever the flag is disabled. */
    defaultValue: jsonb("default_value").$type<FlagValue>().notNull(),
    isClientSafe: boolean("is_client_safe").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUser.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same key in two applications is two different flags.
    unique("flag_application_key_unique").on(t.applicationId, t.key),
    index("flag_archived_at_idx").on(t.archivedAt),
    index("flag_application_idx").on(t.applicationId),
    // Backstop only — domain validation in packages/core produces user-facing errors.
    check(
      "flag_default_value_matches_type",
      sql`(${t.type} = 'boolean' AND jsonb_typeof(${t.defaultValue}) = 'boolean')
       OR (${t.type} = 'string'  AND jsonb_typeof(${t.defaultValue}) = 'string')
       OR (${t.type} = 'number'  AND jsonb_typeof(${t.defaultValue}) = 'number')
       OR (${t.type} = 'json')`,
    ),
  ],
);

export const flagEnvironment = pgTable(
  "flag_environment",
  {
    flagId: uuid("flag_id")
      .notNull()
      .references(() => flag.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    state: flagEnvState("state").notNull().default("not_promoted"),
    enabled: boolean("enabled").notNull().default(false),
    value: jsonb("value").$type<FlagValue>().notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    firstEnabledAt: timestamp("first_enabled_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => appUser.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.flagId, t.environmentId] }),
    index("flag_environment_env_state_idx").on(t.environmentId, t.state),
  ],
);

export const envPermission = pgTable(
  "env_permission",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    permission: envPermissionKind("permission").notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.environmentId, t.permission] })],
);

export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: apiKeyKind("kind").notNull(),
    /** Displayable head of the key, e.g. `cbr_prod_7f3` */
    prefix: text("prefix").notNull(),
    /** sha256 of the full key — the raw key is never stored. */
    keyHash: text("key_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_key_environment_id_idx").on(t.environmentId),
    index("api_key_application_idx").on(t.applicationId),
  ],
);

export const promotion = pgTable(
  "promotion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => flag.id, { onDelete: "cascade" }),
    /** null for the initial creation in the rank-0 environment. */
    fromEnvId: uuid("from_env_id").references(() => environment.id, { onDelete: "set null" }),
    // A promotion into a deleted environment has nothing left to describe.
    toEnvId: uuid("to_env_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    valueSnapshot: jsonb("value_snapshot").$type<FlagValue>().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("promotion_flag_created_idx").on(t.flagId, t.createdAt.desc())],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => appUser.id),
    /** See the action vocabulary in spec §4. */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    applicationId: uuid("application_id").references(() => application.id, {
      onDelete: "set null",
    }),
    // The audit trail outlives the environment it refers to.
    environmentId: uuid("environment_id").references(() => environment.id, {
      onDelete: "set null",
    }),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_created_at_idx").on(t.createdAt.desc()),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);

export type AppUser = typeof appUser.$inferSelect;
export type Environment = typeof environment.$inferSelect;
export type Application = typeof application.$inferSelect;
export type ApplicationEnvironment = typeof applicationEnvironment.$inferSelect;
export type Flag = typeof flag.$inferSelect;
export type FlagEnvironment = typeof flagEnvironment.$inferSelect;
export type EnvPermission = typeof envPermission.$inferSelect;
export type ApiKey = typeof apiKey.$inferSelect;
export type Promotion = typeof promotion.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type Session = typeof session.$inferSelect;

export type UserRole = (typeof userRole.enumValues)[number];
export type FlagType = (typeof flagType.enumValues)[number];
export type FlagEnvState = (typeof flagEnvState.enumValues)[number];
export type EnvPermissionKind = (typeof envPermissionKind.enumValues)[number];
export type ApiKeyKind = (typeof apiKeyKind.enumValues)[number];
