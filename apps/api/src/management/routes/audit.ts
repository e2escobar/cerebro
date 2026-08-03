import { listAuditQuery } from "@cerebro/contracts";
import { assertCan, getApplicationByKey, listAudit } from "@cerebro/core";
import { db } from "@cerebro/db";
import { Hono } from "hono";
import { iso } from "../../lib/serialize.ts";
import { query } from "../../lib/validate.ts";
import type { SessionVariables } from "../middleware/session.ts";

export const auditRoutes = new Hono<{ Variables: SessionVariables }>();

/** Readable by any authenticated user (spec §5.6). */
auditRoutes.get("/", async (c) => {
  assertCan(c.get("actor"), "audit.read");
  const { application, ...filters } = query(c, listAuditQuery);
  const applicationId = application
    ? (await getApplicationByKey(db, application)).id
    : undefined;
  const { items, nextCursor } = await listAudit(db, { ...filters, applicationId });

  return c.json({
    items: items.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      environmentKey: entry.environmentKey,
      applicationKey: entry.applicationKey,
      actor: entry.actorId ? { id: entry.actorId, name: entry.actorName } : null,
      before: entry.before,
      after: entry.after,
      createdAt: iso(entry.createdAt),
    })),
    nextCursor,
  });
});
