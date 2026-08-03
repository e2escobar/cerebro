import { Hono } from "hono";
import { handleError } from "../lib/errors.ts";
import { requireSession, type SessionVariables } from "./middleware/session.ts";
import { applicationRoutes } from "./routes/applications.ts";
import { auditRoutes } from "./routes/audit.ts";
import { authRoutes } from "./routes/auth.ts";
import { environmentRoutes } from "./routes/environments.ts";
import { flagRoutes } from "./routes/flags.ts";
import { keyRoutes } from "./routes/keys.ts";
import { userRoutes } from "./routes/users.ts";

/**
 * Management API route tree (spec §7.2). Shares no middleware with the
 * evaluation tree — the two can be split into separate deployments untouched.
 */
export const managementRouter = new Hono<{ Variables: SessionVariables }>();

managementRouter.onError(handleError);

managementRouter.route("/v1/auth", authRoutes);

const mgmt = new Hono<{ Variables: SessionVariables }>();
mgmt.use("*", requireSession);
mgmt.route("/applications", applicationRoutes);
// Flags live inside an application — the key pair identifies them (§12).
mgmt.route("/applications/:appKey/flags", flagRoutes);
mgmt.route("/environments", environmentRoutes);
mgmt.route("/api-keys", keyRoutes);
mgmt.route("/users", userRoutes);
mgmt.route("/audit", auditRoutes);

managementRouter.route("/v1/mgmt", mgmt);
