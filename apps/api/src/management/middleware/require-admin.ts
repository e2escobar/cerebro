import { Forbidden } from "@cerebro/core";
import type { MiddlewareHandler } from "hono";
import type { SessionVariables } from "./session.ts";

/** Guards the admin-only route groups (spec §5.6). */
export const requireAdmin: MiddlewareHandler<{ Variables: SessionVariables }> = async (c, next) => {
  if (c.get("actor").role !== "admin") {
    throw new Forbidden("This action requires an admin");
  }
  await next();
};
