import {
  environment,
  flagEnvironment,
  promotion,
  type Environment,
  type FlagEnvironment,
  type Tx,
} from "@cerebro/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import { bumpConfigVersion, getEnvironmentByKey, type Ctx } from "./environments.ts";
import { Conflict, NotFound, RuleViolation } from "./errors.ts";
import { getFlag } from "./flags.ts";
import { assertCan } from "./rbac.ts";

/**
 * Sequential promotion (spec §5.3).
 *
 * Promotion is structural: it makes a flag available in an environment. It
 * never enables it — that is a separate, freely reversible axis (§14).
 */

interface EnvRow extends Environment {
  state: FlagEnvironment["state"];
  value: FlagEnvironment["value"];
}

async function loadFlagEnvRows(db: Tx, flagId: string): Promise<EnvRow[]> {
  const rows = await db
    .select({ env: environment, state: flagEnvironment.state, value: flagEnvironment.value })
    .from(flagEnvironment)
    .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
    .where(eq(flagEnvironment.flagId, flagId))
    .orderBy(asc(environment.rank));

  return rows.map((r) => ({ ...r.env, state: r.state, value: r.value }));
}

export interface PromotableCheck {
  /** The row the value is copied from — the highest promoted environment below the target. */
  source: EnvRow;
  target: EnvRow;
}

/**
 * The five guards from spec §5.3. Permission is checked by the caller so this
 * stays usable as a read-only "could this be promoted?" probe.
 */
export async function assertPromotable(
  db: Tx,
  flagId: string,
  targetEnvId: string,
): Promise<PromotableCheck> {
  const rows = await loadFlagEnvRows(db, flagId);
  const target = rows.find((r) => r.id === targetEnvId);
  if (!target) {
    throw new NotFound("ENVIRONMENT_NOT_FOUND", "Flag is not present in that environment");
  }

  // 1. Target must not be the creation environment.
  if (target.rank === 0) {
    throw new RuleViolation(
      "CANNOT_PROMOTE_INTO_BASE_ENVIRONMENT",
      `Flags are created directly in '${target.key}' — there is nothing to promote from`,
      { environment: target.key },
    );
  }

  // 5. Promoting twice is a conflict.
  if (target.state === "promoted") {
    throw new Conflict("ALREADY_PROMOTED", `Flag is already promoted to '${target.key}'`, {
      environment: target.key,
    });
  }

  // 3. Must be promoted in *every* lower-ranked environment.
  const below = rows.filter((r) => r.rank < target.rank);
  const gaps = below.filter((r) => r.state !== "promoted");
  if (gaps.length > 0) {
    throw new RuleViolation(
      "FLAG_NOT_PROMOTABLE",
      `Flag must be promoted to ${gaps.map((g) => `'${g.key}'`).join(", ")} first`,
      { missing: gaps.map((g) => g.key), target: target.key },
    );
  }

  const source = below.at(-1);
  if (!source) {
    throw new RuleViolation("FLAG_NOT_PROMOTABLE", "No environment below the target", {
      target: target.key,
    });
  }

  return { source, target };
}

export async function promoteFlag(
  ctx: Ctx,
  applicationId: string,
  flagKey: string,
  envKey: string,
): Promise<FlagEnvironment> {
  const { db, actor } = ctx;

  // 2. Flag must not be archived.
  const target = await getFlag(db, applicationId, flagKey);
  if (target.archivedAt) {
    throw new RuleViolation("FLAG_ARCHIVED", `Flag '${flagKey}' is archived`, { key: flagKey });
  }

  const env = await getEnvironmentByKey(db, envKey);
  // 4. Actor needs `promote` on the target environment (admins bypass).
  assertCan(actor, "flag.promote", env.id);

  const { source } = await assertPromotable(db, target.id, env.id);

  const now = new Date();
  const [updated] = await db
    .update(flagEnvironment)
    .set({
      state: "promoted",
      promotedAt: now,
      // Promotion never enables a flag (§5.3).
      enabled: false,
      value: source.value,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(and(eq(flagEnvironment.flagId, target.id), eq(flagEnvironment.environmentId, env.id)))
    .returning();
  if (!updated) throw new Error("failed to promote flag");

  await db.insert(promotion).values({
    flagId: target.id,
    fromEnvId: source.id,
    toEnvId: env.id,
    valueSnapshot: source.value,
    actorId: actor.id,
  });

  await bumpConfigVersion(db, applicationId, env.id);

  await writeAudit(db, {
    actorId: actor.id,
    action: "flag.promoted",
    entityType: "flag",
    entityId: target.id,
    environmentId: env.id,
    applicationId,
    before: { state: "not_promoted" },
    after: { state: "promoted", from: source.key, value: source.value },
  });

  return updated;
}

/** Demotion is admin-only and blocked while the flag lives higher up (§5.3). */
export async function demoteFlag(
  ctx: Ctx,
  applicationId: string,
  flagKey: string,
  envKey: string,
): Promise<FlagEnvironment> {
  const { db, actor } = ctx;
  assertCan(actor, "flag.demote");

  const target = await getFlag(db, applicationId, flagKey);
  const env = await getEnvironmentByKey(db, envKey);

  const [current] = await db
    .select()
    .from(flagEnvironment)
    .where(and(eq(flagEnvironment.flagId, target.id), eq(flagEnvironment.environmentId, env.id)))
    .limit(1);
  if (!current) {
    throw new NotFound("FLAG_NOT_FOUND", "Flag is not present in that environment");
  }
  if (current.state !== "promoted") {
    throw new Conflict("NOT_PROMOTED", `Flag is not promoted to '${envKey}'`);
  }

  const higher = await db
    .select({ key: environment.key })
    .from(flagEnvironment)
    .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
    .where(
      and(
        eq(flagEnvironment.flagId, target.id),
        eq(flagEnvironment.state, "promoted"),
        gt(environment.rank, env.rank),
      ),
    );

  if (higher.length > 0) {
    throw new RuleViolation(
      "PROMOTED_IN_HIGHER_ENVIRONMENT",
      `Demote from ${higher.map((h) => `'${h.key}'`).join(", ")} first`,
      { promotedIn: higher.map((h) => h.key) },
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(flagEnvironment)
    .set({
      state: "not_promoted",
      enabled: false,
      promotedAt: null,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(and(eq(flagEnvironment.flagId, target.id), eq(flagEnvironment.environmentId, env.id)))
    .returning();
  if (!updated) throw new Error("failed to demote flag");

  await bumpConfigVersion(db, applicationId, env.id);

  await writeAudit(db, {
    actorId: actor.id,
    action: "flag.demoted",
    entityType: "flag",
    entityId: target.id,
    environmentId: env.id,
    applicationId,
    before: { state: "promoted", enabled: current.enabled },
    after: { state: "not_promoted", enabled: false },
  });

  return updated;
}

/** Promotion history for a flag, oldest first — it reads as a pipeline. */
export async function listPromotions(db: Tx, flagId: string) {
  const rows = await db
    .select()
    .from(promotion)
    .where(eq(promotion.flagId, flagId))
    .orderBy(asc(promotion.createdAt));

  const envRows = await db.select({ id: environment.id, key: environment.key }).from(environment);
  const keyById = new Map(envRows.map((e) => [e.id, e.key]));

  return rows.map((r) => ({
    id: r.id,
    fromEnv: r.fromEnvId ? (keyById.get(r.fromEnvId) ?? null) : null,
    toEnv: keyById.get(r.toEnvId) ?? null,
    valueSnapshot: r.valueSnapshot,
    actorId: r.actorId,
    createdAt: r.createdAt,
  }));
}
