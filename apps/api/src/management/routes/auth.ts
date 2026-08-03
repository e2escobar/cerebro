import { loginRequest } from "@cerebro/contracts";
import { getUserByEmail, listEnvironments, Unauthenticated } from "@cerebro/core";
import { db } from "@cerebro/db";
import { Hono } from "hono";
import { iso } from "../../lib/serialize.ts";
import { body } from "../../lib/validate.ts";
import {
  clearSessionCookie,
  destroySession,
  issueSession,
  readSessionToken,
  requireSession,
  setSessionCookie,
  type SessionVariables,
} from "../middleware/session.ts";

export const authRoutes = new Hono<{ Variables: SessionVariables }>();

/** Verified against when the email is unknown, so timing does not leak accounts. */
const DUMMY_HASH = await Bun.password.hash(crypto.randomUUID());

authRoutes.post("/login", async (c) => {
  const input = await body(c, loginRequest);

  const user = await getUserByEmail(db, input.email);
  const ok = await Bun.password
    .verify(input.password, user?.passwordHash ?? DUMMY_HASH)
    .catch(() => false);

  if (!user || !ok || user.disabledAt) {
    throw new Unauthenticated("Email or password is incorrect");
  }

  const { token, expiresAt } = await issueSession(user.id);
  await setSessionCookie(c, token, expiresAt);

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: iso(user.createdAt),
  });
});

authRoutes.post("/logout", async (c) => {
  const token = await readSessionToken(c);
  if (token) await destroySession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/** Current user plus their effective permissions per environment (spec §7.2). */
authRoutes.get("/me", requireSession, async (c) => {
  const actor = c.get("actor");
  const environments = await listEnvironments(db);

  return c.json({
    id: actor.id,
    email: actor.email,
    name: actor.name,
    role: actor.role,
    permissions: environments.map((env) => ({
      environmentKey: env.key,
      permissions:
        actor.role === "admin"
          ? ["read", "write", "toggle", "promote"]
          : [...(actor.permissions.get(env.id) ?? [])],
    })),
  });
});
