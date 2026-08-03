import { buildEvaluationPayload, getConfigVersion } from "@cerebro/core";
import { db } from "@cerebro/db";
import { Hono } from "hono";
import { handleError } from "../lib/errors.ts";
import { getCached, setCached } from "./cache.ts";
import { requireSdkKey, type EvaluationVariables } from "./middleware/sdk-key.ts";

/**
 * Evaluation API route tree (spec §7.1). Deliberately shares no middleware
 * with the management tree.
 */
export const evaluationRouter = new Hono<{ Variables: EvaluationVariables }>();

evaluationRouter.onError(handleError);
evaluationRouter.use("/v1/flags", requireSdkKey);
evaluationRouter.use("/v1/config-version", requireSdkKey);

evaluationRouter.get("/v1/flags", async (c) => {
  const key = c.get("apiKey");
  const env = c.get("environment");
  const app = c.get("application");
  // Versions are per (application, environment), so another team's release
  // never invalidates this key's cached payload.
  const version = await getConfigVersion(db, app.id, env.id);

  const etag = `W/"${app.key}-${env.key}-${version}"`;
  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=30");
  c.header("X-Config-Version", String(version));

  if (c.req.header("If-None-Match") === etag) {
    return c.body(null, 304);
  }

  const cached = getCached(`${app.id}:${env.id}`, key.kind, version);
  if (cached) return c.json(cached);

  const payload = await buildEvaluationPayload(db, app.id, env.id, {
    clientOnly: key.kind === "client",
  });
  setCached(`${app.id}:${env.id}`, key.kind, version, payload);

  return c.json(payload);
});

/** Cheap poll target (spec §7.1). */
evaluationRouter.get("/v1/config-version", async (c) => {
  const env = c.get("environment");
  const app = c.get("application");
  const version = await getConfigVersion(db, app.id, env.id);
  return c.json({ version, environment: env.key, application: app.key });
});
