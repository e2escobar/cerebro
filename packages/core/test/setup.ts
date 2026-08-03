import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createClient } from "@cerebro/db";

/**
 * Preloaded once per `bun test` process: makes sure the dedicated test database
 * exists and is migrated (spec §12). Individual files truncate between runs.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Missing required environment variable: TEST_DATABASE_URL");

const parsed = new URL(url);
const databaseName = parsed.pathname.slice(1);

const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

const admin = postgres(adminUrl.toString(), { max: 1 });
const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`;
if (!existing) {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
}
await admin.end();

const { sql, db } = createClient(url, { max: 1, onNotice: () => {} });
await migrate(db, {
  migrationsFolder: new URL("../../db/drizzle", import.meta.url).pathname,
});
await sql.end();
