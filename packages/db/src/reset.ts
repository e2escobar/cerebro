import { createClient } from "./client.ts";

/** Drops and recreates the public schema. Development convenience only. */

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing required environment variable: DATABASE_URL");
if (url.includes("prod")) throw new Error("refusing to reset a database whose URL contains 'prod'");

const { sql } = createClient(url, { max: 1 });

// The `drizzle` schema holds migration bookkeeping — dropping only `public`
// would leave the migrator believing every migration is still applied.
await sql.unsafe(`
  DROP SCHEMA IF EXISTS public CASCADE;
  DROP SCHEMA IF EXISTS drizzle CASCADE;
  CREATE SCHEMA public;
`);
console.log("public and drizzle schemas dropped — run db:migrate next");

await sql.end();
