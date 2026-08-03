import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createClient } from "./client.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing required environment variable: DATABASE_URL");

const { sql, db } = createClient(url, { max: 1 });

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
console.log(`migrations applied to ${url.replace(/\/\/[^@]*@/, "//***@")}`);

await sql.end();
