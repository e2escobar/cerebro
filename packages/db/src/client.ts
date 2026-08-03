import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * A database handle: either the pool-backed `db` or an open transaction.
 * Every domain function in `packages/core` takes one of these so callers
 * decide the transaction boundary.
 */
export type Tx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createClient(
  connectionString: string,
  options?: { max?: number; onNotice?: (notice: unknown) => void },
) {
  const sql = postgres(connectionString, {
    max: options?.max ?? 10,
    onnotice: options?.onNotice,
  });
  return { sql, db: drizzle(sql, { schema }) satisfies Database };
}

function connectionStringFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing required environment variable: DATABASE_URL");
  return url;
}

let cached: ReturnType<typeof createClient> | undefined;

/** Lazily-created process-wide client. Tests build their own via `createClient`. */
function client() {
  cached ??= createClient(connectionStringFromEnv());
  return cached;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = client().db;
    const value: unknown = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export function closeDb(): Promise<void> {
  return cached ? cached.sql.end() : Promise.resolve();
}
