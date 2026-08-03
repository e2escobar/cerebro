import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { docsRouter } from "./docs/router.ts";
import { evaluationRouter } from "./evaluation/router.ts";
import { env } from "./lib/env.ts";
import { handleError } from "./lib/errors.ts";
import { managementRouter } from "./management/router.ts";

/**
 * Server bootstrap. Mounts two independent route trees on one process
 * (spec §2.3): the evaluation API and the management API.
 */

export const app = new Hono();

app.onError(handleError);
if (!env.isTest) app.use("*", logger());

// The dashboard forwards its session cookie, so credentials must be allowed.
app.use("/v1/auth/*", cors({ origin: env.corsOrigins, credentials: true }));
app.use("/v1/mgmt/*", cors({ origin: env.corsOrigins, credentials: true }));
// SDK keys are used from anywhere; there is no cookie to protect here. ETag and
// X-Config-Version are not CORS-safelisted, so without exposeHeaders a browser
// reads them as null — the conditional request in §9 would never be sent and
// every poll would transfer the whole payload.
const evaluationCors = cors({ origin: "*", exposeHeaders: ["ETag", "X-Config-Version"] });
app.use("/v1/flags", evaluationCors);
app.use("/v1/config-version", evaluationCors);

app.get("/health", (c) => c.json({ status: "ok", service: "cerebro-api" }));

app.route("/", docsRouter);
app.route("/", evaluationRouter);
app.route("/", managementRouter);

export default {
  port: env.port,
  fetch: app.fetch,
};
