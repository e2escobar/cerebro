import { eq } from "drizzle-orm";
import { createClient } from "./client.ts";
import {
  appUser,
  application,
  applicationEnvironment,
  envPermission,
  environment,
  type EnvPermissionKind,
} from "./schema.ts";

/**
 * Idempotent seed (spec §11, phase 1). Re-running changes nothing.
 */

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing required environment variable: DATABASE_URL");

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@local";
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Missing required environment variable: SEED_ADMIN_PASSWORD");

const developerEmail = process.env.SEED_DEVELOPER_EMAIL ?? "dev@local";
const developerPassword = process.env.SEED_DEVELOPER_PASSWORD ?? adminPassword;

const { sql, db } = createClient(url, { max: 1 });

const ENVIRONMENTS = [
  { key: "dev", name: "Development", rank: 0, isProtected: false },
  { key: "qa", name: "QA", rank: 1, isProtected: false },
  { key: "prod", name: "Production", rank: 2, isProtected: true },
] as const;

const DEVELOPER_GRANTS: Record<string, EnvPermissionKind[]> = {
  dev: ["read", "write", "toggle", "promote"],
  qa: ["read", "write", "toggle", "promote"],
  prod: ["read"],
};

async function upsertUser(email: string, name: string, password: string, role: "admin" | "developer") {
  const existing = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(appUser)
    .values({ email, name, passwordHash: await Bun.password.hash(password), role })
    .returning();
  if (!created) throw new Error(`failed to create user ${email}`);
  return created;
}

const admin = await upsertUser(adminEmail, "Admin", adminPassword, "admin");
const developer = await upsertUser(developerEmail, "Developer", developerPassword, "developer");

for (const env of ENVIRONMENTS) {
  await db.insert(environment).values(env).onConflictDoNothing({ target: environment.key });
}

const environments = await db.select().from(environment);
const byKey = new Map(environments.map((e) => [e.key, e]));

// Flags need an application to belong to, so a fresh install gets one.
await db
  .insert(application)
  .values({
    key: "default",
    name: "Default",
    description: "A starting point — rename it, or add your own applications.",
    createdBy: admin.id,
  })
  .onConflictDoNothing({ target: application.key });

const applications = await db.select().from(application);
await db
  .insert(applicationEnvironment)
  .values(
    applications.flatMap((app) =>
      environments.map((env) => ({ applicationId: app.id, environmentId: env.id })),
    ),
  )
  .onConflictDoNothing();

for (const [envKey, permissions] of Object.entries(DEVELOPER_GRANTS)) {
  const env = byKey.get(envKey);
  if (!env) continue;
  for (const permission of permissions) {
    await db
      .insert(envPermission)
      .values({
        userId: developer.id,
        environmentId: env.id,
        permission,
        grantedBy: admin.id,
      })
      .onConflictDoNothing();
  }
}

console.log(`seeded: admin=${admin.email} developer=${developer.email}`);
console.log(`environments: ${environments.map((e) => `${e.key}(rank ${e.rank})`).join(", ")}`);
console.log(`applications: ${applications.map((a) => a.key).join(", ")}`);

await sql.end();
