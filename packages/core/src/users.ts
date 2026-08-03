import {
  appUser,
  envPermission,
  environment,
  type AppUser,
  type EnvPermissionKind,
  type Tx,
  type UserRole,
} from "@cerebro/db";
import { asc, eq } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import { type Ctx } from "./environments.ts";
import { Conflict, NotFound, ValidationError } from "./errors.ts";
import { assertCan } from "./rbac.ts";

/** User and permission administration (spec §7.2). Admin-only throughout. */

export type PublicUser = Omit<AppUser, "passwordHash">;

export function toPublicUser(user: AppUser): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function listUsers(db: Tx): Promise<PublicUser[]> {
  const rows = await db.select().from(appUser).orderBy(asc(appUser.createdAt));
  return rows.map(toPublicUser);
}

export async function getUserById(db: Tx, id: string): Promise<AppUser> {
  const [row] = await db.select().from(appUser).where(eq(appUser.id, id)).limit(1);
  if (!row) throw new NotFound("USER_NOT_FOUND", "User not found", { id });
  return row;
}

export async function getUserByEmail(db: Tx, email: string): Promise<AppUser | null> {
  const [row] = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1);
  return row ?? null;
}

export async function createUser(
  { db, actor }: Ctx,
  input: { email: string; name: string; password: string; role?: UserRole },
): Promise<PublicUser> {
  assertCan(actor, "user.manage");

  if (input.password.length < 8) {
    throw new ValidationError("VALIDATION_FAILED", "Password must be at least 8 characters");
  }
  if (await getUserByEmail(db, input.email)) {
    throw new Conflict("USER_EMAIL_TAKEN", `A user with email '${input.email}' already exists`);
  }

  const [created] = await db
    .insert(appUser)
    .values({
      email: input.email,
      name: input.name,
      passwordHash: await Bun.password.hash(input.password),
      role: input.role ?? "developer",
    })
    .returning();
  if (!created) throw new Error("failed to create user");

  await writeAudit(db, {
    actorId: actor.id,
    action: "user.created",
    entityType: "user",
    entityId: created.id,
    after: toPublicUser(created),
  });

  return toPublicUser(created);
}

export async function updateUser(
  { db, actor }: Ctx,
  id: string,
  patch: { name?: string; role?: UserRole; disabled?: boolean; password?: string },
): Promise<PublicUser> {
  assertCan(actor, "user.manage");
  const before = await getUserById(db, id);

  if (patch.password !== undefined && patch.password.length < 8) {
    throw new ValidationError("VALIDATION_FAILED", "Password must be at least 8 characters");
  }

  const disabledAt =
    patch.disabled === undefined ? before.disabledAt : patch.disabled ? new Date() : null;

  const [updated] = await db
    .update(appUser)
    .set({
      name: patch.name ?? before.name,
      role: patch.role ?? before.role,
      disabledAt,
      passwordHash: patch.password ? await Bun.password.hash(patch.password) : before.passwordHash,
    })
    .where(eq(appUser.id, id))
    .returning();
  if (!updated) throw new Error("failed to update user");

  const becameDisabled = !before.disabledAt && updated.disabledAt;
  await writeAudit(db, {
    actorId: actor.id,
    action: becameDisabled ? "user.disabled" : "user.updated",
    entityType: "user",
    entityId: id,
    before: toPublicUser(before),
    after: toPublicUser(updated),
  });

  return toPublicUser(updated);
}

export interface PermissionGrant {
  environmentKey: string;
  permissions: EnvPermissionKind[];
}

export async function listUserPermissions(db: Tx, userId: string): Promise<PermissionGrant[]> {
  const rows = await db
    .select({ environmentKey: environment.key, permission: envPermission.permission })
    .from(envPermission)
    .innerJoin(environment, eq(environment.id, envPermission.environmentId))
    .where(eq(envPermission.userId, userId))
    .orderBy(asc(environment.rank));

  const byEnv = new Map<string, EnvPermissionKind[]>();
  for (const row of rows) {
    const list = byEnv.get(row.environmentKey) ?? [];
    list.push(row.permission);
    byEnv.set(row.environmentKey, list);
  }
  return [...byEnv].map(([environmentKey, permissions]) => ({ environmentKey, permissions }));
}

/** Full replace of a user's grants (spec §7.2: `PUT .../permissions`). */
export async function setUserPermissions(
  { db, actor }: Ctx,
  userId: string,
  grants: PermissionGrant[],
): Promise<PermissionGrant[]> {
  assertCan(actor, "permission.manage");
  await getUserById(db, userId);

  const before = await listUserPermissions(db, userId);
  const environments = await db.select().from(environment);
  const idByKey = new Map(environments.map((e) => [e.key, e.id]));

  for (const grant of grants) {
    if (!idByKey.has(grant.environmentKey)) {
      throw new NotFound(
        "ENVIRONMENT_NOT_FOUND",
        `Environment '${grant.environmentKey}' not found`,
        { key: grant.environmentKey },
      );
    }
  }

  await db.delete(envPermission).where(eq(envPermission.userId, userId));

  const values = grants.flatMap((grant) =>
    grant.permissions.map((permission) => ({
      userId,
      environmentId: idByKey.get(grant.environmentKey) as string,
      permission,
      grantedBy: actor.id,
    })),
  );
  if (values.length > 0) {
    await db.insert(envPermission).values(values).onConflictDoNothing();
  }

  const after = await listUserPermissions(db, userId);

  await writeAudit(db, {
    actorId: actor.id,
    action: after.length >= before.length ? "permission.granted" : "permission.revoked",
    entityType: "permission",
    entityId: userId,
    before,
    after,
  });

  return after;
}
