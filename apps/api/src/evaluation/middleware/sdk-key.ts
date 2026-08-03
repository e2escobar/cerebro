import { resolveKey, touchApiKey, Unauthenticated } from "@cerebro/core";
import { db, type ApiKey, type Application, type Environment } from "@cerebro/db";
import type { MiddlewareHandler } from "hono";

/**
 * SDK key authentication (spec §7.1). The environment is derived from the key
 * and never from a path or query parameter.
 */

export interface EvaluationVariables {
  apiKey: ApiKey;
  environment: Environment;
  /** A key resolves to a pair — the application matters as much as the env. */
  application: Application;
}

/** `last_used_at` is written at most once a minute per key (§7.1). */
const TOUCH_INTERVAL_MS = 60_000;
const lastTouched = new Map<string, number>();

async function touchThrottled(keyId: string): Promise<void> {
  const now = Date.now();
  const previous = lastTouched.get(keyId);
  if (previous !== undefined && now - previous < TOUCH_INTERVAL_MS) return;

  lastTouched.set(keyId, now);
  await touchApiKey(db, keyId);
}

export const requireSdkKey: MiddlewareHandler<{ Variables: EvaluationVariables }> = async (
  c,
  next,
) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  if (!token) throw new Unauthenticated("Missing bearer SDK key");

  const resolved = await resolveKey(db, token);
  if (!resolved) throw new Unauthenticated("Invalid or revoked SDK key");

  c.set("apiKey", resolved.key);
  c.set("environment", resolved.environment);
  c.set("application", resolved.application);

  await touchThrottled(resolved.key.id);
  await next();
};
