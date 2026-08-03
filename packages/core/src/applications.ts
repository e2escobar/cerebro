import {
  application,
  applicationEnvironment,
  environment,
  flag,
  type Application,
  type Tx,
} from "@cerebro/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import type { Ctx } from "./environments.ts";
import { Conflict, NotFound, RuleViolation, ValidationError } from "./errors.ts";
import { assertCan } from "./rbac.ts";

/**
 * Applications own flags. Two applications may each hold a flag called
 * `new-checkout`; they are unrelated flags with their own type, default and
 * per-environment state.
 *
 * An application must exist before any flag can be created, and the payload
 * version is tracked per (application, environment) so one team's release does
 * not invalidate another's cached payload.
 */

export const APPLICATION_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export async function listApplications(
  db: Tx,
  options: { includeArchived?: boolean } = {},
): Promise<Application[]> {
  return db
    .select()
    .from(application)
    .where(options.includeArchived ? undefined : isNull(application.archivedAt))
    .orderBy(asc(application.key));
}

export async function getApplicationByKey(db: Tx, key: string): Promise<Application> {
  const [row] = await db.select().from(application).where(eq(application.key, key)).limit(1);
  if (!row) {
    throw new NotFound("APPLICATION_NOT_FOUND", `Application '${key}' not found`, { key });
  }
  return row;
}

/** Ensures a row exists for every (application, environment) pair. */
async function backfillVersions(db: Tx, applicationId: string): Promise<void> {
  const environments = await db.select({ id: environment.id }).from(environment);
  if (environments.length === 0) return;

  await db
    .insert(applicationEnvironment)
    .values(environments.map((env) => ({ applicationId, environmentId: env.id })))
    .onConflictDoNothing();
}

/** Called when a new environment joins the pipeline — every app needs a row. */
export async function backfillVersionsForEnvironment(
  db: Tx,
  environmentId: string,
): Promise<void> {
  const applications = await db.select({ id: application.id }).from(application);
  if (applications.length === 0) return;

  await db
    .insert(applicationEnvironment)
    .values(applications.map((app) => ({ applicationId: app.id, environmentId })))
    .onConflictDoNothing();
}

export async function createApplication(
  { db, actor }: Ctx,
  input: { key: string; name: string; description?: string },
): Promise<Application> {
  assertCan(actor, "application.manage");

  if (!APPLICATION_KEY_PATTERN.test(input.key)) {
    throw new ValidationError("VALIDATION_FAILED", "Invalid application key", { key: input.key });
  }

  const existing = await db
    .select({ id: application.id })
    .from(application)
    .where(eq(application.key, input.key))
    .limit(1);
  if (existing[0]) {
    throw new Conflict("APPLICATION_KEY_TAKEN", `Application '${input.key}' already exists`);
  }

  const [created] = await db
    .insert(application)
    .values({
      key: input.key,
      name: input.name,
      description: input.description ?? "",
      createdBy: actor.id,
    })
    .returning();
  if (!created) throw new Error("failed to create application");

  await backfillVersions(db, created.id);

  await writeAudit(db, {
    actorId: actor.id,
    action: "application.created",
    entityType: "application",
    entityId: created.id,
    applicationId: created.id,
    after: created,
  });

  return created;
}

export async function updateApplication(
  { db, actor }: Ctx,
  key: string,
  patch: { name?: string; description?: string },
): Promise<Application> {
  assertCan(actor, "application.manage");
  const before = await getApplicationByKey(db, key);

  const [updated] = await db
    .update(application)
    .set({
      name: patch.name ?? before.name,
      description: patch.description ?? before.description,
    })
    .where(eq(application.id, before.id))
    .returning();
  if (!updated) throw new Error("failed to update application");

  await writeAudit(db, {
    actorId: actor.id,
    action: "application.updated",
    entityType: "application",
    entityId: before.id,
    applicationId: before.id,
    before,
    after: updated,
  });

  return updated;
}

/** Refused while the application still owns flags — archive them first. */
export async function deleteApplication({ db, actor }: Ctx, key: string): Promise<void> {
  assertCan(actor, "application.manage");
  const target = await getApplicationByKey(db, key);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flag)
    .where(and(eq(flag.applicationId, target.id), isNull(flag.archivedAt)));

  if (count > 0) {
    throw new RuleViolation(
      "APPLICATION_IN_USE",
      `Cannot delete '${key}' — it still owns ${count} flag${count === 1 ? "" : "s"}`,
      { application: key, flags: count },
    );
  }

  await db.delete(application).where(eq(application.id, target.id));

  await writeAudit(db, {
    actorId: actor.id,
    action: "application.deleted",
    entityType: "application",
    entityId: target.id,
    before: target,
  });
}

export type { Application };
