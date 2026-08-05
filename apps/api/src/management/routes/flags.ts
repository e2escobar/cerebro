import {
  createFlagRequest,
  listFlagsQuery,
  setEnabledRequest,
  setValueRequest,
  updateFlagRequest,
  type FlagDetail,
} from "@cerebro/contracts";
import {
  archiveFlag,
  can,
  createFlag,
  demoteFlag,
  environmentCapabilities,
  Forbidden,
  getApplicationByKey,
  getFlag,
  listAudit,
  listFlagEnvironments,
  listFlags,
  listPromotions,
  promoteFlag,
  restoreFlag,
  setValue,
  toggle,
  updateFlag,
  ValidationError,
  type Actor,
  type Application,
} from "@cerebro/core";
import { appUser, db } from "@cerebro/db";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { iso } from "../../lib/serialize.ts";
import { body, query } from "../../lib/validate.ts";
import type { SessionVariables } from "../middleware/session.ts";

export const flagRoutes = new Hono<{ Variables: SessionVariables }>();

/** Names for the user ids referenced by a flag detail response. */
async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(inArray(appUser.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** `:appKey` is a path parameter on every route in this tree. */
async function app(c: { req: { param: (name: string) => string } }): Promise<Application> {
  return getApplicationByKey(db, c.req.param("appKey"));
}

async function buildFlagDetail(
  actor: Actor,
  application: Application,
  key: string,
): Promise<FlagDetail> {
  const flag = await getFlag(db, application.id, key);
  const environments = await listFlagEnvironments(db, flag.id);
  const promotions = await listPromotions(db, flag.id);
  const audit = await listAudit(db, { entityType: "flag", entityId: flag.id, limit: 10 });

  const names = await namesFor([
    flag.createdBy,
    ...environments.map((e) => e.updatedBy),
    ...promotions.map((p) => p.actorId),
  ]);

  return {
    applicationKey: application.key,
    key: flag.key,
    name: flag.name,
    description: flag.description,
    type: flag.type,
    defaultValue: flag.defaultValue,
    isClientSafe: flag.isClientSafe,
    archivedAt: iso(flag.archivedAt),
    createdBy: { id: flag.createdBy, name: names.get(flag.createdBy) ?? "" },
    createdAt: iso(flag.createdAt),
    updatedAt: iso(flag.updatedAt),
    environments: environments.map((env) => ({
      key: env.environmentKey,
      name: env.environmentName,
      rank: env.rank,
      state: env.state,
      enabled: env.enabled,
      value: env.value,
      isProtected: env.isProtected,
      promotedAt: iso(env.promotedAt),
      firstEnabledAt: iso(env.firstEnabledAt),
      updatedBy: env.updatedBy
        ? { id: env.updatedBy, name: names.get(env.updatedBy) ?? "" }
        : null,
      updatedAt: iso(env.updatedAt),
      // Computed server-side — the dashboard must not re-derive these (§7.2).
      ...environmentCapabilities({ actor }, env.environmentId, env.state),
    })),
    promotions: promotions.map((p) => ({
      fromEnv: p.fromEnv,
      toEnv: p.toEnv,
      actor: names.get(p.actorId) ?? null,
      createdAt: iso(p.createdAt),
    })),
    recentAudit: audit.items.map((entry) => ({
      id: entry.id,
      action: entry.action,
      environmentKey: entry.environmentKey,
      actor: entry.actorName,
      createdAt: iso(entry.createdAt),
    })),
  };
}

flagRoutes.get("/", async (c) => {
  const filters = query(c, listFlagsQuery);
  const application = await app(c);
  const { items, nextCursor } = await listFlags(db, { ...filters, applicationId: application.id });

  return c.json({
    items: items.map((flag) => ({
      applicationKey: application.key,
      key: flag.key,
      name: flag.name,
      description: flag.description,
      type: flag.type,
      defaultValue: flag.defaultValue,
      isClientSafe: flag.isClientSafe,
      archivedAt: iso(flag.archivedAt),
      createdAt: iso(flag.createdAt),
      updatedAt: iso(flag.updatedAt),
      environments: flag.environments.map((env) => ({
        key: env.environmentKey,
        rank: env.rank,
        state: env.state,
        enabled: env.enabled,
        value: env.value,
        updatedAt: iso(env.updatedAt),
      })),
    })),
    nextCursor,
  });
});

flagRoutes.post("/", async (c) => {
  const input = await body(c, createFlagRequest);
  const actor = c.get("actor");

  // Zod types an `unknown` field as optional, so presence is checked here.
  // `undefined` is not a JSON value and must not reach the validator as one.
  if (input.defaultValue === undefined) {
    throw new ValidationError("VALIDATION_FAILED", "defaultValue is required");
  }

  const application = await app(c);
  const created = await db.transaction((tx) =>
    createFlag(
      { db: tx, actor },
      { ...input, applicationId: application.id, defaultValue: input.defaultValue },
    ),
  );
  return c.json(await buildFlagDetail(actor, application, created.key), 201);
});

flagRoutes.get("/:key", async (c) => {
  const actor = c.get("actor");
  const key = c.req.param("key");

  // Visible only to someone who can read it in at least one environment.
  const application = await app(c);
  const flag = await getFlag(db, application.id, key);
  const environments = await listFlagEnvironments(db, flag.id);
  if (!environments.some((env) => can(actor, "flag.read", env.environmentId))) {
    throw new Forbidden("You cannot read this flag in any environment", { key });
  }

  return c.json(await buildFlagDetail(actor, application, key));
});

flagRoutes.patch("/:key", async (c) => {
  const patch = await body(c, updateFlagRequest);
  const actor = c.get("actor");
  const key = c.req.param("key");

  const application = await app(c);
  // The patch may have moved the key, so read the detail back under the new one.
  const updated = await db.transaction((tx) =>
    updateFlag({ db: tx, actor }, application.id, key, patch),
  );
  return c.json(await buildFlagDetail(actor, application, updated.key));
});

flagRoutes.post("/:key/archive", async (c) => {
  const actor = c.get("actor");
  const key = c.req.param("key");
  const application = await app(c);
  await db.transaction((tx) => archiveFlag({ db: tx, actor }, application.id, key));
  return c.json(await buildFlagDetail(actor, application, key));
});

flagRoutes.post("/:key/restore", async (c) => {
  const actor = c.get("actor");
  const key = c.req.param("key");
  const application = await app(c);
  await db.transaction((tx) => restoreFlag({ db: tx, actor }, application.id, key));
  return c.json(await buildFlagDetail(actor, application, key));
});

flagRoutes.put("/:key/environments/:envKey/value", async (c) => {
  const { value } = await body(c, setValueRequest);
  const actor = c.get("actor");
  const key = c.req.param("key");

  const application = await app(c);
  await db.transaction((tx) =>
    setValue({ db: tx, actor }, application.id, key, c.req.param("envKey"), value),
  );
  return c.json(await buildFlagDetail(actor, application, key));
});

flagRoutes.put("/:key/environments/:envKey/enabled", async (c) => {
  const { enabled } = await body(c, setEnabledRequest);
  const actor = c.get("actor");
  const key = c.req.param("key");

  const application = await app(c);
  await db.transaction((tx) =>
    toggle({ db: tx, actor }, application.id, key, c.req.param("envKey"), enabled),
  );
  return c.json(await buildFlagDetail(actor, application, key));
});

flagRoutes.post("/:key/environments/:envKey/promote", async (c) => {
  const actor = c.get("actor");
  const key = c.req.param("key");

  const application = await app(c);
  await db.transaction((tx) =>
    promoteFlag({ db: tx, actor }, application.id, key, c.req.param("envKey")),
  );
  return c.json(await buildFlagDetail(actor, application, key));
});

flagRoutes.delete("/:key/environments/:envKey/promote", async (c) => {
  const actor = c.get("actor");
  const key = c.req.param("key");

  const application = await app(c);
  await db.transaction((tx) =>
    demoteFlag({ db: tx, actor }, application.id, key, c.req.param("envKey")),
  );
  return c.json(await buildFlagDetail(actor, application, key));
});
