import {
  application,
  applicationEnvironment,
  environment,
  flag,
  flagEnvironment,
  type Environment,
  type Tx,
} from "@cerebro/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import { Conflict, NotFound, RuleViolation, ValidationError } from "./errors.ts";
import { assertCan, type Actor } from "./rbac.ts";

export const ENVIRONMENT_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export interface Ctx {
  db: Tx;
  actor: Actor;
}

/**
 * Bumps the payload version SDK clients poll on (spec §9), for one application
 * in one environment — so one team's release does not invalidate every other
 * application's cached payload.
 */
export async function bumpConfigVersion(
  db: Tx,
  applicationId: string,
  environmentId: string,
): Promise<void> {
  await db
    .insert(applicationEnvironment)
    .values({ applicationId, environmentId, configVersion: 2 })
    .onConflictDoUpdate({
      target: [applicationEnvironment.applicationId, applicationEnvironment.environmentId],
      set: { configVersion: sql`${applicationEnvironment.configVersion} + 1` },
    });
}

/** For changes that alter what every environment serves for one application. */
export async function bumpAllConfigVersions(db: Tx, applicationId: string): Promise<void> {
  await db
    .update(applicationEnvironment)
    .set({ configVersion: sql`${applicationEnvironment.configVersion} + 1` })
    .where(eq(applicationEnvironment.applicationId, applicationId));
}

export async function getConfigVersion(
  db: Tx,
  applicationId: string,
  environmentId: string,
): Promise<number> {
  const [row] = await db
    .select({ configVersion: applicationEnvironment.configVersion })
    .from(applicationEnvironment)
    .where(
      and(
        eq(applicationEnvironment.applicationId, applicationId),
        eq(applicationEnvironment.environmentId, environmentId),
      ),
    )
    .limit(1);
  return row?.configVersion ?? 1;
}

export async function listEnvironments(db: Tx): Promise<Environment[]> {
  return db.select().from(environment).orderBy(asc(environment.rank));
}

export async function getEnvironmentByKey(db: Tx, key: string): Promise<Environment> {
  const [row] = await db.select().from(environment).where(eq(environment.key, key)).limit(1);
  if (!row) throw new NotFound("ENVIRONMENT_NOT_FOUND", `Environment '${key}' not found`, { key });
  return row;
}

/** The rank-0 environment — where flags are created (spec §5.2). */
export async function getBaseEnvironment(db: Tx): Promise<Environment> {
  const [row] = await db.select().from(environment).orderBy(asc(environment.rank)).limit(1);
  if (!row) {
    throw new RuleViolation("NO_BASE_ENVIRONMENT", "No environments exist yet");
  }
  return row;
}

export interface CreateEnvironmentInput {
  key: string;
  name: string;
  rank: number;
  isProtected?: boolean;
}

export async function createEnvironment(
  { db, actor }: Ctx,
  input: CreateEnvironmentInput,
): Promise<Environment> {
  assertCan(actor, "environment.create");

  if (!ENVIRONMENT_KEY_PATTERN.test(input.key)) {
    throw new ValidationError("VALIDATION_FAILED", "Invalid environment key", { key: input.key });
  }

  const existingKey = await db
    .select({ id: environment.id })
    .from(environment)
    .where(eq(environment.key, input.key))
    .limit(1);
  if (existingKey[0]) {
    throw new Conflict("ENVIRONMENT_KEY_TAKEN", `Environment '${input.key}' already exists`);
  }

  const existingRank = await db
    .select({ id: environment.id })
    .from(environment)
    .where(eq(environment.rank, input.rank))
    .limit(1);
  if (existingRank[0]) {
    throw new Conflict("ENVIRONMENT_RANK_TAKEN", `Rank ${input.rank} is already taken`, {
      rank: input.rank,
    });
  }

  const [created] = await db
    .insert(environment)
    .values({
      key: input.key,
      name: input.name,
      rank: input.rank,
      isProtected: input.isProtected ?? false,
    })
    .returning();
  if (!created) throw new Error("failed to create environment");

  // Every application needs a version row for the new environment.
  const applications = await db.select({ id: application.id }).from(application);
  if (applications.length > 0) {
    await db
      .insert(applicationEnvironment)
      .values(applications.map((app) => ({ applicationId: app.id, environmentId: created.id })))
      .onConflictDoNothing();
  }

  // Backfill a not_promoted row for every existing non-archived flag (§5.2).
  const flags = await db
    .select({ id: flag.id, defaultValue: flag.defaultValue })
    .from(flag)
    .where(isNull(flag.archivedAt));

  if (flags.length > 0) {
    await db.insert(flagEnvironment).values(
      flags.map((f) => ({
        flagId: f.id,
        environmentId: created.id,
        state: "not_promoted" as const,
        enabled: false,
        value: f.defaultValue,
        updatedBy: actor.id,
      })),
    );
  }

  await writeAudit(db, {
    actorId: actor.id,
    action: "environment.created",
    entityType: "environment",
    entityId: created.id,
    environmentId: created.id,
    after: created,
  });

  return created;
}

export async function updateEnvironment(
  { db, actor }: Ctx,
  key: string,
  patch: { name?: string; isProtected?: boolean },
): Promise<Environment> {
  assertCan(actor, "environment.update");
  const before = await getEnvironmentByKey(db, key);

  const [updated] = await db
    .update(environment)
    .set({
      name: patch.name ?? before.name,
      isProtected: patch.isProtected ?? before.isProtected,
    })
    .where(eq(environment.id, before.id))
    .returning();
  if (!updated) throw new Error("failed to update environment");

  await writeAudit(db, {
    actorId: actor.id,
    action: "environment.updated",
    entityType: "environment",
    entityId: before.id,
    environmentId: before.id,
    before,
    after: updated,
  });

  return updated;
}

export async function deleteEnvironment({ db, actor }: Ctx, key: string): Promise<void> {
  assertCan(actor, "environment.delete");
  const target = await getEnvironmentByKey(db, key);

  const promoted = await db
    .select({ flagKey: flag.key })
    .from(flagEnvironment)
    .innerJoin(flag, eq(flag.id, flagEnvironment.flagId))
    .where(
      and(eq(flagEnvironment.environmentId, target.id), eq(flagEnvironment.state, "promoted")),
    );

  if (promoted.length > 0) {
    throw new RuleViolation(
      "ENVIRONMENT_IN_USE",
      `Cannot delete '${key}' — flags are promoted there`,
      { flags: promoted.map((p) => p.flagKey) },
    );
  }

  await db.delete(environment).where(eq(environment.id, target.id));

  await writeAudit(db, {
    actorId: actor.id,
    action: "environment.deleted",
    entityType: "environment",
    entityId: target.id,
    before: target,
  });
}

/**
 * Reassigns ranks in one transaction (spec §7.2).
 *
 * Rejects any order that would place an environment where a flag is promoted
 * above one where it is not — the whole flag set is validated before committing.
 */
export async function reorderEnvironments(
  { db, actor }: Ctx,
  order: string[],
): Promise<Environment[]> {
  assertCan(actor, "environment.reorder");

  const existing = await listEnvironments(db);
  const existingKeys = existing.map((e) => e.key).sort();
  const proposedKeys = [...order].sort();

  if (
    existingKeys.length !== proposedKeys.length ||
    existingKeys.some((k, i) => k !== proposedKeys[i])
  ) {
    throw new ValidationError(
      "INVALID_ENVIRONMENT_ORDER",
      "Order must list every environment exactly once",
      { expected: existingKeys, received: proposedKeys },
    );
  }

  const byKey = new Map(existing.map((e) => [e.key, e]));
  const newRankByEnvId = new Map<string, number>();
  order.forEach((key, index) => {
    const env = byKey.get(key);
    if (env) newRankByEnvId.set(env.id, index);
  });

  // Validate against the full flag set: under the new ranks, a promoted
  // environment may never sit above a not-promoted one for the same flag.
  const rows = await db
    .select({
      flagKey: flag.key,
      environmentId: flagEnvironment.environmentId,
      state: flagEnvironment.state,
    })
    .from(flagEnvironment)
    .innerJoin(flag, eq(flag.id, flagEnvironment.flagId))
    .where(isNull(flag.archivedAt));

  const byFlag = new Map<string, { rank: number; promoted: boolean }[]>();
  for (const row of rows) {
    const rank = newRankByEnvId.get(row.environmentId);
    if (rank === undefined) continue;
    const list = byFlag.get(row.flagKey) ?? [];
    list.push({ rank, promoted: row.state === "promoted" });
    byFlag.set(row.flagKey, list);
  }

  const violations: { flag: string; environments: string[] }[] = [];
  const keyByRank = new Map(order.map((key, index) => [index, key]));

  for (const [flagKey, states] of byFlag) {
    states.sort((a, b) => a.rank - b.rank);
    const firstGap = states.findIndex((s) => !s.promoted);
    if (firstGap === -1) continue;
    const promotedAboveGap = states.slice(firstGap + 1).filter((s) => s.promoted);
    if (promotedAboveGap.length > 0) {
      violations.push({
        flag: flagKey,
        environments: promotedAboveGap.map((s) => keyByRank.get(s.rank) ?? String(s.rank)),
      });
    }
  }

  if (violations.length > 0) {
    throw new RuleViolation(
      "INVALID_ENVIRONMENT_ORDER",
      "This order would leave flags promoted above an environment they are not promoted in",
      { violations },
    );
  }

  // Two-step to dodge the unique constraint on rank while shuffling.
  const ids = existing.map((e) => e.id);
  await db
    .update(environment)
    .set({ rank: sql`-1 - ${environment.rank}` })
    .where(inArray(environment.id, ids));

  for (const [environmentId, rank] of newRankByEnvId) {
    await db.update(environment).set({ rank }).where(eq(environment.id, environmentId));
  }

  const updated = await listEnvironments(db);

  await writeAudit(db, {
    actorId: actor.id,
    action: "environment.reordered",
    entityType: "environment",
    before: existing.map((e) => ({ key: e.key, rank: e.rank })),
    after: updated.map((e) => ({ key: e.key, rank: e.rank })),
  });

  return updated;
}
