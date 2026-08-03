import { createApplicationRequest, updateApplicationRequest } from "@cerebro/contracts";
import {
  createApplication,
  deleteApplication,
  listApplications,
  updateApplication,
} from "@cerebro/core";
import { db, flag, type Application } from "@cerebro/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { iso } from "../../lib/serialize.ts";
import { body } from "../../lib/validate.ts";
import { requireAdmin } from "../middleware/require-admin.ts";
import type { SessionVariables } from "../middleware/session.ts";

export const applicationRoutes = new Hono<{ Variables: SessionVariables }>();

function serialize(app: Application, flagCount = 0) {
  return {
    key: app.key,
    name: app.name,
    description: app.description,
    archivedAt: iso(app.archivedAt),
    createdAt: iso(app.createdAt),
    flagCount,
  };
}

/**
 * Readable by every signed-in user — you cannot pick an application to work in
 * without seeing the list. Creating and deleting them is admin-only.
 */
applicationRoutes.get("/", async (c) => {
  const applications = await listApplications(db);

  const counts = await db
    .select({ applicationId: flag.applicationId, count: sql<number>`count(*)::int` })
    .from(flag)
    .where(isNull(flag.archivedAt))
    .groupBy(flag.applicationId);
  const byId = new Map(counts.map((row) => [row.applicationId, row.count]));

  return c.json({ items: applications.map((app) => serialize(app, byId.get(app.id) ?? 0)) });
});

applicationRoutes.post("/", requireAdmin, async (c) => {
  const input = await body(c, createApplicationRequest);
  const actor = c.get("actor");
  const created = await db.transaction((tx) => createApplication({ db: tx, actor }, input));
  return c.json(serialize(created), 201);
});

applicationRoutes.patch("/:appKey", requireAdmin, async (c) => {
  const patch = await body(c, updateApplicationRequest);
  const actor = c.get("actor");
  const updated = await db.transaction((tx) =>
    updateApplication({ db: tx, actor }, c.req.param("appKey"), patch),
  );

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flag)
    .where(and(eq(flag.applicationId, updated.id), isNull(flag.archivedAt)));

  return c.json(serialize(updated, count));
});

applicationRoutes.delete("/:appKey", requireAdmin, async (c) => {
  const actor = c.get("actor");
  await db.transaction((tx) => deleteApplication({ db: tx, actor }, c.req.param("appKey")));
  return c.json({ ok: true });
});
