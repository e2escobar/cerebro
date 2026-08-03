import {
  environment,
  flag,
  flagEnvironment,
  promotion,
  type Flag,
  type FlagEnvironment,
  type FlagType,
  type FlagValue,
  type Tx,
} from "@cerebro/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import {
  bumpAllConfigVersions,
  bumpConfigVersion,
  getBaseEnvironment,
  getEnvironmentByKey,
  listEnvironments,
  type Ctx,
} from "./environments.ts";
import { Conflict, Forbidden, NotFound, RuleViolation, ValidationError } from "./errors.ts";
import { validateValue } from "./flag-value.ts";
import { assertCan, can } from "./rbac.ts";

export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * A flag is identified by (application, key) — the same key in two
 * applications is two unrelated flags.
 */
export async function getFlag(db: Tx, applicationId: string, key: string): Promise<Flag> {
  const [row] = await db
    .select()
    .from(flag)
    .where(and(eq(flag.applicationId, applicationId), eq(flag.key, key)))
    .limit(1);
  if (!row) throw new NotFound("FLAG_NOT_FOUND", `Flag '${key}' not found`, { key });
  return row;
}

async function getFlagEnvironment(
  db: Tx,
  flagId: string,
  environmentId: string,
): Promise<FlagEnvironment> {
  const [row] = await db
    .select()
    .from(flagEnvironment)
    .where(
      and(eq(flagEnvironment.flagId, flagId), eq(flagEnvironment.environmentId, environmentId)),
    )
    .limit(1);
  if (!row) {
    throw new NotFound("FLAG_NOT_FOUND", "Flag is not present in that environment", {
      flagId,
      environmentId,
    });
  }
  return row;
}

function assertNotArchived(row: Flag): void {
  if (row.archivedAt) {
    throw new RuleViolation("FLAG_ARCHIVED", `Flag '${row.key}' is archived`, { key: row.key });
  }
}

export interface CreateFlagInput {
  applicationId: string;
  key: string;
  name: string;
  description?: string;
  type: FlagType;
  defaultValue: unknown;
  isClientSafe?: boolean;
  /** Value in the base environment. Falls back to `defaultValue`. */
  initialValue?: unknown;
}

/**
 * Creates a flag (spec §5.2). One transaction, six steps — the caller owns the
 * transaction boundary, so `db` here is expected to be a transaction handle.
 */
export async function createFlag(ctx: Ctx, input: CreateFlagInput): Promise<Flag> {
  const { db, actor } = ctx;
  const base = await getBaseEnvironment(db);
  assertCan(actor, "flag.create", base.id);

  if (!FLAG_KEY_PATTERN.test(input.key)) {
    throw new ValidationError("VALIDATION_FAILED", "Invalid flag key", { key: input.key });
  }

  const existing = await db
    .select({ id: flag.id })
    .from(flag)
    .where(and(eq(flag.applicationId, input.applicationId), eq(flag.key, input.key)))
    .limit(1);
  if (existing[0]) {
    throw new Conflict("FLAG_KEY_TAKEN", `This application already has a flag '${input.key}'`, {
      key: input.key,
    });
  }

  const defaultValue = validateValue(input.type, input.defaultValue);
  const initialValue =
    input.initialValue === undefined ? defaultValue : validateValue(input.type, input.initialValue);

  const [created] = await db
    .insert(flag)
    .values({
      applicationId: input.applicationId,
      key: input.key,
      name: input.name,
      description: input.description ?? "",
      type: input.type,
      defaultValue,
      isClientSafe: input.isClientSafe ?? false,
      createdBy: actor.id,
    })
    .returning();
  if (!created) throw new Error("failed to create flag");

  const environments = await listEnvironments(db);
  const now = new Date();

  await db.insert(flagEnvironment).values(
    environments.map((env) => ({
      flagId: created.id,
      environmentId: env.id,
      state: env.id === base.id ? ("promoted" as const) : ("not_promoted" as const),
      enabled: false,
      value: env.id === base.id ? initialValue : defaultValue,
      promotedAt: env.id === base.id ? now : null,
      updatedBy: actor.id,
    })),
  );

  await db.insert(promotion).values({
    flagId: created.id,
    fromEnvId: null,
    toEnvId: base.id,
    valueSnapshot: initialValue,
    actorId: actor.id,
  });

  await bumpConfigVersion(db, created.applicationId, base.id);

  await writeAudit(db, {
    actorId: actor.id,
    action: "flag.created",
    entityType: "flag",
    entityId: created.id,
    environmentId: base.id,
    applicationId: created.applicationId,
    after: created,
  });

  return created;
}

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  isClientSafe?: boolean;
}

/** Metadata only. `type` and `key` are immutable (spec §5.1, §7.2). */
export async function updateFlag(
  ctx: Ctx,
  applicationId: string,
  key: string,
  patch: UpdateFlagInput,
): Promise<Flag> {
  const { db, actor } = ctx;
  const base = await getBaseEnvironment(db);
  assertCan(actor, "flag.update_metadata", base.id);

  const before = await getFlag(db, applicationId, key);
  assertNotArchived(before);

  const [updated] = await db
    .update(flag)
    .set({
      name: patch.name ?? before.name,
      description: patch.description ?? before.description,
      isClientSafe: patch.isClientSafe ?? before.isClientSafe,
      updatedAt: new Date(),
    })
    .where(eq(flag.id, before.id))
    .returning();
  if (!updated) throw new Error("failed to update flag");

  // `is_client_safe` changes what client keys see in *every* environment,
  // but only for this application (spec §9).
  if (patch.isClientSafe !== undefined && patch.isClientSafe !== before.isClientSafe) {
    await bumpAllConfigVersions(db, applicationId);
  }

  await writeAudit(db, {
    actorId: actor.id,
    action: "flag.updated",
    entityType: "flag",
    entityId: before.id,
    applicationId,
    before,
    after: updated,
  });

  return updated;
}

/** Archive requires admin, or `write` on rank 0 with the flag unpromoted above it (§5.6). */
async function assertCanArchive(ctx: Ctx, target: Flag, action: "flag.archive" | "flag.restore") {
  const { db, actor } = ctx;
  const base = await getBaseEnvironment(db);
  assertCan(actor, action, base.id);
  if (actor.role === "admin") return;

  const promotedAbove = await db
    .select({ environmentId: flagEnvironment.environmentId })
    .from(flagEnvironment)
    .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
    .where(
      and(
        eq(flagEnvironment.flagId, target.id),
        eq(flagEnvironment.state, "promoted"),
        gt(environment.rank, base.rank),
      ),
    );

  if (promotedAbove.length > 0) {
    throw new Forbidden("Only an admin can archive a flag promoted above the base environment", {
      key: target.key,
    });
  }
}

export async function archiveFlag(ctx: Ctx, applicationId: string, key: string): Promise<Flag> {
  const { db, actor } = ctx;
  const before = await getFlag(db, applicationId, key);
  if (before.archivedAt) {
    throw new Conflict("FLAG_ARCHIVED", `Flag '${key}' is already archived`);
  }
  await assertCanArchive(ctx, before, "flag.archive");

  const [updated] = await db
    .update(flag)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(flag.id, before.id))
    .returning();
  if (!updated) throw new Error("failed to archive flag");

  await bumpAllConfigVersions(db, applicationId);

  await writeAudit(db, {
    actorId: actor.id,
    action: "flag.archived",
    entityType: "flag",
    entityId: before.id,
    applicationId,
    before,
    after: updated,
  });

  return updated;
}

export async function restoreFlag(ctx: Ctx, applicationId: string, key: string): Promise<Flag> {
  const { db, actor } = ctx;
  const before = await getFlag(db, applicationId, key);
  if (!before.archivedAt) {
    throw new RuleViolation("FLAG_NOT_ARCHIVED", `Flag '${key}' is not archived`);
  }
  await assertCanArchive(ctx, before, "flag.restore");

  const [updated] = await db
    .update(flag)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(flag.id, before.id))
    .returning();
  if (!updated) throw new Error("failed to restore flag");

  await bumpAllConfigVersions(db, applicationId);

  await writeAudit(db, {
    actorId: actor.id,
    action: "flag.restored",
    entityType: "flag",
    entityId: before.id,
    applicationId,
    before,
    after: updated,
  });

  return updated;
}

/** Sets the per-environment value. Requires `write` on that environment (§5.4). */
export async function setValue(
  ctx: Ctx,
  applicationId: string,
  flagKey: string,
  envKey: string,
  value: unknown,
): Promise<FlagEnvironment> {
  const { db, actor } = ctx;
  const target = await getFlag(db, applicationId, flagKey);
  assertNotArchived(target);
  const env = await getEnvironmentByKey(db, envKey);
  assertCan(actor, "flag.set_value", env.id);

  const before = await getFlagEnvironment(db, target.id, env.id);
  const nextValue = validateValue(target.type, value);

  const [updated] = await db
    .update(flagEnvironment)
    .set({ value: nextValue, updatedBy: actor.id, updatedAt: new Date() })
    .where(and(eq(flagEnvironment.flagId, target.id), eq(flagEnvironment.environmentId, env.id)))
    .returning();
  if (!updated) throw new Error("failed to set value");

  await bumpConfigVersion(db, applicationId, env.id);

  await writeAudit(db, {
    actorId: actor.id,
    action: "flag.value_changed",
    entityType: "flag",
    entityId: target.id,
    environmentId: env.id,
    applicationId,
    before: { value: before.value },
    after: { value: updated.value },
  });

  return updated;
}

/**
 * The kill switch (spec §5.4). Toggles in either direction with no ordering
 * constraint, but only where the flag has actually been promoted — an
 * unpromoted flag is absent from that environment's payload entirely (§5.5).
 */
export async function toggle(
  ctx: Ctx,
  applicationId: string,
  flagKey: string,
  envKey: string,
  enabled: boolean,
): Promise<FlagEnvironment> {
  const { db, actor } = ctx;
  const target = await getFlag(db, applicationId, flagKey);
  assertNotArchived(target);
  const env = await getEnvironmentByKey(db, envKey);
  assertCan(actor, "flag.toggle", env.id);

  const before = await getFlagEnvironment(db, target.id, env.id);
  if (before.state !== "promoted") {
    throw new Conflict("NOT_PROMOTED", `Flag '${flagKey}' is not promoted to '${envKey}'`, {
      flag: flagKey,
      environment: envKey,
    });
  }

  const now = new Date();
  const [updated] = await db
    .update(flagEnvironment)
    .set({
      enabled,
      firstEnabledAt: enabled && !before.firstEnabledAt ? now : before.firstEnabledAt,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(and(eq(flagEnvironment.flagId, target.id), eq(flagEnvironment.environmentId, env.id)))
    .returning();
  if (!updated) throw new Error("failed to toggle flag");

  await bumpConfigVersion(db, applicationId, env.id);

  await writeAudit(db, {
    actorId: actor.id,
    action: enabled ? "flag.enabled" : "flag.disabled",
    entityType: "flag",
    entityId: target.id,
    environmentId: env.id,
    applicationId,
    before: { enabled: before.enabled },
    after: { enabled: updated.enabled },
  });

  return updated;
}

export interface FlagEnvironmentView extends FlagEnvironment {
  environmentKey: string;
  environmentName: string;
  rank: number;
  isProtected: boolean;
}

/** Per-environment rows for a flag, in rank order. */
export async function listFlagEnvironments(db: Tx, flagId: string): Promise<FlagEnvironmentView[]> {
  const rows = await db
    .select({
      row: flagEnvironment,
      environmentKey: environment.key,
      environmentName: environment.name,
      rank: environment.rank,
      isProtected: environment.isProtected,
    })
    .from(flagEnvironment)
    .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
    .where(eq(flagEnvironment.flagId, flagId))
    .orderBy(asc(environment.rank));

  return rows.map((r) => ({
    ...r.row,
    environmentKey: r.environmentKey,
    environmentName: r.environmentName,
    rank: r.rank,
    isProtected: r.isProtected,
  }));
}

/** Convenience for the API layer: the `can*` booleans in the flag detail payload. */
export function environmentCapabilities(
  ctx: Pick<Ctx, "actor">,
  environmentId: string,
  state: FlagEnvironment["state"],
) {
  return {
    canWrite: can(ctx.actor, "flag.set_value", environmentId),
    canToggle: state === "promoted" && can(ctx.actor, "flag.toggle", environmentId),
    canPromote: state === "not_promoted" && can(ctx.actor, "flag.promote", environmentId),
  };
}

export type { Flag, FlagEnvironment, FlagValue };
