import { createClient } from "@cerebro/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * API tests run against the dedicated test database. Pointing DATABASE_URL at
 * it before anything imports `@cerebro/db` works because that client is lazy.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Missing required environment variable: TEST_DATABASE_URL");
process.env.DATABASE_URL = url;
process.env.NODE_ENV = "test";

const parsed = new URL(url);
const databaseName = parsed.pathname.slice(1);

const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`;
if (!existing) await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
await admin.end();

const { sql, db } = createClient(url, { max: 1, onNotice: () => {} });
await migrate(db, { migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url).pathname });
await sql.end();
