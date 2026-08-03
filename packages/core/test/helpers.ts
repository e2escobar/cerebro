import {
  appUser,
  application,
  applicationEnvironment,
  createClient,
  envPermission,
  environment,
  type Application,
  type Database,
  type EnvPermissionKind,
  type Environment,
} from "@cerebro/db";
import type { Actor } from "../src/rbac.ts";
import { loadActor } from "../src/rbac.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Missing required environment variable: TEST_DATABASE_URL");

const client = createClient(url, { max: 5 });
export const db: Database = client.db;
export const rawSql = client.sql;

export async function truncateAll(): Promise<void> {
  await rawSql.unsafe(`
    TRUNCATE TABLE audit_log, promotion, api_key, env_permission,
                   flag_environment, flag, application_environment, application,
                   session, environment, app_user
    RESTART IDENTITY CASCADE
  `);
}

export const DEFAULT_ENVIRONMENTS = [
  { key: "dev", name: "Development", rank: 0, isProtected: false },
  { key: "qa", name: "QA", rank: 1, isProtected: false },
  { key: "prod", name: "Production", rank: 2, isProtected: true },
];

export interface Fixture {
  admin: Actor;
  developer: Actor;
  environments: Record<string, Environment>;
  /** Flags must belong to an application, so every fixture provides one. */
  application: Application;
  /** A second application, for proving one never sees the other's flags. */
  otherApplication: Application;
}

/**
 * A clean world: three ranked environments, an admin, and a developer holding
 * every permission on dev and qa but only `read` on prod — the seed shape.
 */
export async function setupFixture(
  developerGrants: Record<string, EnvPermissionKind[]> = {
    dev: ["read", "write", "toggle", "promote"],
    qa: ["read", "write", "toggle", "promote"],
    prod: ["read"],
  },
): Promise<Fixture> {
  await truncateAll();

  const [adminRow] = await db
    .insert(appUser)
    .values({ email: "admin@test", name: "Admin", passwordHash: "x", role: "admin" })
    .returning();
  const [developerRow] = await db
    .insert(appUser)
    .values({ email: "dev@test", name: "Dev", passwordHash: "x", role: "developer" })
    .returning();
  if (!adminRow || !developerRow) throw new Error("failed to create fixture users");

  const envRows = await db.insert(environment).values(DEFAULT_ENVIRONMENTS).returning();
  const environments: Record<string, Environment> = {};
  for (const env of envRows) environments[env.key] = env;

  const grants = Object.entries(developerGrants).flatMap(([key, permissions]) =>
    permissions.map((permission) => ({
      userId: developerRow.id,
      environmentId: environments[key]?.id as string,
      permission,
      grantedBy: adminRow.id,
    })),
  );
  if (grants.length > 0) await db.insert(envPermission).values(grants);

  const [app, otherApp] = await db
    .insert(application)
    .values([
      { key: "checkout", name: "Checkout", createdBy: adminRow.id },
      { key: "mobile", name: "Mobile", createdBy: adminRow.id },
    ])
    .returning();
  if (!app || !otherApp) throw new Error("failed to create fixture applications");

  await db.insert(applicationEnvironment).values(
    [app, otherApp].flatMap((a) =>
      envRows.map((env) => ({ applicationId: a.id, environmentId: env.id })),
    ),
  );

  return {
    admin: await loadActor(db, adminRow.id),
    developer: await loadActor(db, developerRow.id),
    environments,
    application: app,
    otherApplication: otherApp,
  };
}

/** Re-reads an actor's grants after a permission change. */
export async function reloadActor(actor: Actor): Promise<Actor> {
  return loadActor(db, actor.id);
}
