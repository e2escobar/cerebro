import { createApiKeyRequest } from "@cerebro/contracts";
import { createApiKey, listApiKeys, revokeApiKey } from "@cerebro/core";
import { db } from "@cerebro/db";
import { Hono } from "hono";
import { iso } from "../../lib/serialize.ts";
import { body } from "../../lib/validate.ts";
import { requireAdmin } from "../middleware/require-admin.ts";
import type { SessionVariables } from "../middleware/session.ts";

export const keyRoutes = new Hono<{ Variables: SessionVariables }>();

keyRoutes.use("*", requireAdmin);

/** Never returns the raw key — only the displayable prefix (spec §8). */
keyRoutes.get("/", async (c) => {
  const keys = await listApiKeys(db);
  return c.json({
    items: keys.map((key) => ({
      id: key.id,
      name: key.name,
      kind: key.kind,
      prefix: key.prefix,
      applicationKey: key.applicationKey,
      environmentKey: key.environmentKey,
      lastUsedAt: iso(key.lastUsedAt),
      revokedAt: iso(key.revokedAt),
      createdAt: iso(key.createdAt),
    })),
  });
});

keyRoutes.post("/", async (c) => {
  const input = await body(c, createApiKeyRequest);
  const actor = c.get("actor");

  const { record, rawKey } = await db.transaction((tx) => createApiKey({ db: tx, actor }, input));

  return c.json(
    {
      id: record.id,
      name: record.name,
      kind: record.kind,
      prefix: record.prefix,
      applicationKey: input.applicationKey,
      environmentKey: input.environmentKey,
      createdAt: iso(record.createdAt),
      // Shown exactly once. There is no endpoint that can return it again.
      key: rawKey,
    },
    201,
  );
});

keyRoutes.delete("/:id", async (c) => {
  const actor = c.get("actor");
  const revoked = await db.transaction((tx) => revokeApiKey({ db: tx, actor }, c.req.param("id")));
  return c.json({ id: revoked.id, revokedAt: iso(revoked.revokedAt) });
});
