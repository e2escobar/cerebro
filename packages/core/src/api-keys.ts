import {
  apiKey,
  application,
  environment,
  type ApiKey,
  type ApiKeyKind,
  type Application,
  type Environment,
  type Tx,
} from "@cerebro/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import { getApplicationByKey } from "./applications.ts";
import { getEnvironmentByKey, type Ctx } from "./environments.ts";
import { NotFound } from "./errors.ts";
import { assertCan } from "./rbac.ts";

/** SDK keys (spec §8). Format: `cbr_<envKey>_<32 url-safe chars>`. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SECRET_LENGTH = 32;
export const KEY_PREFIX_LENGTH = 12;

/** `cbr_<appKey>_<envKey>_<32>` — the key names the pair it resolves to. */
export function generateKey(applicationKey: string, envKey: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_LENGTH));
  let secret = "";
  for (const byte of bytes) secret += ALPHABET[byte % ALPHABET.length];
  return `cbr_${applicationKey}_${envKey}_${secret}`;
}

export function hashKey(fullKey: string): string {
  return new Bun.CryptoHasher("sha256").update(fullKey).digest("hex");
}

export interface CreatedApiKey {
  record: ApiKey;
  /** Returned exactly once, at creation, and never retrievable again (§8). */
  rawKey: string;
}

export async function createApiKey(
  { db, actor }: Ctx,
  input: { applicationKey: string; environmentKey: string; name: string; kind: ApiKeyKind },
): Promise<CreatedApiKey> {
  assertCan(actor, "api_key.create");
  const app = await getApplicationByKey(db, input.applicationKey);
  const env = await getEnvironmentByKey(db, input.environmentKey);

  const rawKey = generateKey(app.key, env.key);
  const [record] = await db
    .insert(apiKey)
    .values({
      applicationId: app.id,
      environmentId: env.id,
      name: input.name,
      kind: input.kind,
      prefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
      keyHash: hashKey(rawKey),
      createdBy: actor.id,
    })
    .returning();
  if (!record) throw new Error("failed to create api key");

  await writeAudit(db, {
    actorId: actor.id,
    action: "api_key.created",
    entityType: "api_key",
    entityId: record.id,
    environmentId: env.id,
    applicationId: app.id,
    after: { name: record.name, kind: record.kind, prefix: record.prefix, application: app.key },
  });

  return { record, rawKey };
}

export async function revokeApiKey({ db, actor }: Ctx, id: string): Promise<ApiKey> {
  assertCan(actor, "api_key.revoke");

  const [before] = await db.select().from(apiKey).where(eq(apiKey.id, id)).limit(1);
  if (!before) throw new NotFound("API_KEY_NOT_FOUND", "API key not found", { id });

  const [updated] = await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(eq(apiKey.id, id))
    .returning();
  if (!updated) throw new Error("failed to revoke api key");

  await writeAudit(db, {
    actorId: actor.id,
    action: "api_key.revoked",
    entityType: "api_key",
    entityId: id,
    environmentId: before.environmentId,
    before: { revokedAt: before.revokedAt },
    after: { revokedAt: updated.revokedAt },
  });

  return updated;
}

export async function listApiKeys(
  db: Tx,
): Promise<(ApiKey & { environmentKey: string; applicationKey: string })[]> {
  const rows = await db
    .select({ key: apiKey, environmentKey: environment.key, applicationKey: application.key })
    .from(apiKey)
    .innerJoin(environment, eq(environment.id, apiKey.environmentId))
    .innerJoin(application, eq(application.id, apiKey.applicationId))
    .orderBy(desc(apiKey.createdAt));
  return rows.map((r) => ({
    ...r.key,
    environmentKey: r.environmentKey,
    applicationKey: r.applicationKey,
  }));
}

export interface ResolvedKey {
  key: ApiKey;
  environment: Environment;
  application: Application;
}

/** Single indexed lookup by hash. Revoked keys resolve to null (§8). */
export async function resolveKey(db: Tx, rawKey: string): Promise<ResolvedKey | null> {
  const [row] = await db
    .select({ key: apiKey, environment, application })
    .from(apiKey)
    .innerJoin(environment, eq(environment.id, apiKey.environmentId))
    .innerJoin(application, eq(application.id, apiKey.applicationId))
    .where(and(eq(apiKey.keyHash, hashKey(rawKey)), isNull(apiKey.revokedAt)))
    .limit(1);

  return row
    ? { key: row.key, environment: row.environment, application: row.application }
    : null;
}

export async function touchApiKey(db: Tx, id: string): Promise<void> {
  await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, id));
}
