import {
  createEnvironmentRequest,
  reorderEnvironmentsRequest,
  updateEnvironmentRequest,
} from "@cerebro/contracts";
import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  reorderEnvironments,
  updateEnvironment,
} from "@cerebro/core";
import { db, type Environment } from "@cerebro/db";
import { Hono } from "hono";
import { iso } from "../../lib/serialize.ts";
import { body } from "../../lib/validate.ts";
import { requireAdmin } from "../middleware/require-admin.ts";
import type { SessionVariables } from "../middleware/session.ts";

export const environmentRoutes = new Hono<{ Variables: SessionVariables }>();

function serialize(env: Environment) {
  return {
    key: env.key,
    name: env.name,
    rank: env.rank,
    isProtected: env.isProtected,
    createdAt: iso(env.createdAt),
  };
}

/** Readable by every authenticated user; everything else is admin-only (§7.2). */
environmentRoutes.get("/", async (c) => {
  const environments = await listEnvironments(db);
  return c.json({ items: environments.map(serialize) });
});

environmentRoutes.post("/", requireAdmin, async (c) => {
  const input = await body(c, createEnvironmentRequest);
  const actor = c.get("actor");
  const created = await db.transaction((tx) => createEnvironment({ db: tx, actor }, input));
  return c.json(serialize(created), 201);
});

// Registered before `/:key` so the literal path is not swallowed by the param.
environmentRoutes.put("/order", requireAdmin, async (c) => {
  const { order } = await body(c, reorderEnvironmentsRequest);
  const actor = c.get("actor");
  const updated = await db.transaction((tx) => reorderEnvironments({ db: tx, actor }, order));
  return c.json({ items: updated.map(serialize) });
});

environmentRoutes.patch("/:key", requireAdmin, async (c) => {
  const patch = await body(c, updateEnvironmentRequest);
  const actor = c.get("actor");
  const updated = await db.transaction((tx) =>
    updateEnvironment({ db: tx, actor }, c.req.param("key"), patch),
  );
  return c.json(serialize(updated));
});

environmentRoutes.delete("/:key", requireAdmin, async (c) => {
  const actor = c.get("actor");
  await db.transaction((tx) => deleteEnvironment({ db: tx, actor }, c.req.param("key")));
  return c.json({ ok: true });
});
