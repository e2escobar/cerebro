import { appUser, db, session, type AppUser } from "@cerebro/db";
import { loadActorPermissions, Unauthenticated, type Actor } from "@cerebro/core";
import { and, eq, gt } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { env } from "../../lib/env.ts";

/**
 * Opaque session tokens (spec §7.2). The cookie carries a random token; only
 * its sha256 is stored, so a database leak yields no usable sessions.
 */

export const SESSION_COOKIE = "cerebro_session";

export interface SessionVariables {
  actor: Actor;
  sessionId: string;
}

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export async function issueSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const expiresAt = new Date(Date.now() + env.sessionTtlHours * 60 * 60 * 1000);

  await db.insert(session).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

export async function setSessionCookie(
  c: Parameters<MiddlewareHandler>[0],
  token: string,
  expiresAt: Date,
): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, token, env.sessionSecret, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(session).where(eq(session.tokenHash, hashToken(token)));
}

export function clearSessionCookie(c: Parameters<MiddlewareHandler>[0]): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function readSessionToken(
  c: Parameters<MiddlewareHandler>[0],
): Promise<string | null> {
  const value = await getSignedCookie(c, env.sessionSecret, SESSION_COOKIE);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Resolves the cookie into an `Actor` and puts it on the context. */
export const requireSession: MiddlewareHandler<{ Variables: SessionVariables }> = async (
  c,
  next,
) => {
  const token = await readSessionToken(c);
  if (!token) {
    // Reaching for an SDK key here is the obvious mistake — the two APIs sit on
    // one server and only the path distinguishes them. Say so, rather than
    // leaving someone to re-read the docs.
    if (c.req.header("Authorization")?.startsWith("Bearer ")) {
      throw new Unauthenticated(
        "The management API authenticates with the cerebro_session cookie, not an SDK key. Sign in with POST /v1/auth/login. SDK keys are for the evaluation API: GET /v1/flags.",
      );
    }
    throw new Unauthenticated(
      "Sign in with POST /v1/auth/login — it sets the cerebro_session cookie this API reads.",
    );
  }

  const [row] = await db
    .select({ session, user: appUser })
    .from(session)
    .innerJoin(appUser, eq(appUser.id, session.userId))
    .where(and(eq(session.tokenHash, hashToken(token)), gt(session.expiresAt, new Date())))
    .limit(1);

  if (!row) throw new Unauthenticated("Session expired or invalid");
  if (row.user.disabledAt) throw new Unauthenticated("This account is disabled");

  c.set("actor", await toActor(row.user));
  c.set("sessionId", row.session.id);
  await next();
};

async function toActor(user: AppUser): Promise<Actor> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: await loadActorPermissions(db, user.id),
  };
}
