import { createUserRequest, setPermissionsRequest, updateUserRequest } from "@cerebro/contracts";
import {
  createUser,
  listUserPermissions,
  listUsers,
  setUserPermissions,
  updateUser,
  type PublicUser,
} from "@cerebro/core";
import { db } from "@cerebro/db";
import { Hono } from "hono";
import { iso } from "../../lib/serialize.ts";
import { body } from "../../lib/validate.ts";
import { requireAdmin } from "../middleware/require-admin.ts";
import type { SessionVariables } from "../middleware/session.ts";

export const userRoutes = new Hono<{ Variables: SessionVariables }>();

userRoutes.use("*", requireAdmin);

function serialize(user: PublicUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabledAt: iso(user.disabledAt),
    createdAt: iso(user.createdAt),
  };
}

userRoutes.get("/", async (c) => {
  const users = await listUsers(db);
  return c.json({ items: users.map(serialize) });
});

userRoutes.post("/", async (c) => {
  const input = await body(c, createUserRequest);
  const actor = c.get("actor");
  const created = await db.transaction((tx) => createUser({ db: tx, actor }, input));
  return c.json(serialize(created), 201);
});

userRoutes.patch("/:id", async (c) => {
  const patch = await body(c, updateUserRequest);
  const actor = c.get("actor");
  const updated = await db.transaction((tx) => updateUser({ db: tx, actor }, c.req.param("id"), patch));
  return c.json(serialize(updated));
});

userRoutes.get("/:id/permissions", async (c) => {
  return c.json({ grants: await listUserPermissions(db, c.req.param("id")) });
});

/** Full replace of a user's grants (spec §7.2). */
userRoutes.put("/:id/permissions", async (c) => {
  const { grants } = await body(c, setPermissionsRequest);
  const actor = c.get("actor");
  const updated = await db.transaction((tx) =>
    setUserPermissions({ db: tx, actor }, c.req.param("id"), grants),
  );
  return c.json({ grants: updated });
});
