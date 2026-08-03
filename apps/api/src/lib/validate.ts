import type { Context } from "hono";
import type { z } from "zod";

/** Parses a JSON body against a contract schema; ZodError maps to 400 upstream. */
export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw: unknown = await c.req.json().catch(() => {
    throw new SyntaxError("Body must be valid JSON");
  });
  return schema.parse(raw) as z.infer<T>;
}

export function query<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return schema.parse(c.req.query()) as z.infer<T>;
}
