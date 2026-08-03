/**
 * cerebro-codegen — writes your application's flags out as a manifest, so
 * `get()` and `useFlag()` narrow per key and the client can validate what the
 * server sends.
 *
 *   cerebro-codegen --app checkout --url http://localhost:3011 \
 *                   --email you@example.com --password ... \
 *                   --out src/cerebro.manifest.ts
 *
 * Flags belong to an application, so the generated manifest covers one — the
 * same one your SDK key resolves to. `--app` may be omitted when only one
 * application exists.
 *
 * Credentials can come from CEREBRO_URL, CEREBRO_EMAIL and CEREBRO_PASSWORD
 * instead. This reads the management API, so it needs a login — an SDK key is
 * not enough, because flag metadata does not live behind one.
 *
 * Plain Node, deliberately: it ships as a bin, and `npx cerebro-codegen` cannot
 * assume Bun is installed.
 */

import { writeFile } from "node:fs/promises";
import { renderDeclaration, renderManifest, type FlagRecord } from "./emit";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function required(name: string, envName: string): string {
  const value = arg(name) ?? process.env[envName];
  if (!value) {
    console.error(`Missing --${name} (or ${envName})`);
    process.exit(1);
  }
  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const baseUrl = (arg("url") ?? process.env.CEREBRO_URL ?? "http://localhost:3011").replace(
  /\/$/,
  "",
);
const email = required("email", "CEREBRO_EMAIL");
const password = required("password", "CEREBRO_PASSWORD");
const format = arg("format") ?? "ts";

if (format !== "ts" && format !== "dts") {
  fail(`Unknown --format '${format}'. Use 'ts' for the manifest or 'dts' for types only.`);
}

const out = arg("out") ?? (format === "ts" ? "cerebro.manifest.ts" : "cerebro-flags.d.ts");

const login = await fetch(`${baseUrl}/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

if (!login.ok) fail(`Could not sign in to ${baseUrl}: ${login.status}`);

const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) fail("The server did not return a session cookie");

interface ApplicationRecord {
  key: string;
}

const appsResponse = await fetch(`${baseUrl}/v1/mgmt/applications`, {
  headers: { Cookie: cookie },
});
if (!appsResponse.ok) fail(`Could not read applications: ${appsResponse.status}`);

const { items: applications } = (await appsResponse.json()) as { items: ApplicationRecord[] };

const requestedApp = arg("app") ?? process.env.CEREBRO_APP;
let applicationKey: string;

if (requestedApp) {
  if (!applications.some((a) => a.key === requestedApp)) {
    const available = applications.map((a) => a.key).join(", ") || "none";
    fail(`No application '${requestedApp}'. Available: ${available}`);
  }
  applicationKey = requestedApp;
} else if (applications.length === 1 && applications[0]) {
  applicationKey = applications[0].key;
} else {
  fail(
    applications.length === 0
      ? "There are no applications yet — an admin creates one before flags can exist."
      : `Several applications exist. Pass --app <key>: ${applications.map((a) => a.key).join(", ")}`,
  );
}

const flags: FlagRecord[] = [];
let cursor: string | null = null;

do {
  const query = new URLSearchParams({ limit: "200" });
  if (cursor) query.set("cursor", cursor);

  const response = await fetch(
    `${baseUrl}/v1/mgmt/applications/${applicationKey}/flags?${query.toString()}`,
    { headers: { Cookie: cookie } },
  );
  if (!response.ok) fail(`Could not read flags: ${response.status}`);

  const page = (await response.json()) as { items: FlagRecord[]; nextCursor: string | null };
  flags.push(...page.items);
  cursor = page.nextCursor;
} while (cursor);

const meta = {
  application: applicationKey,
  source: baseUrl,
  generatedAt: new Date().toISOString(),
};

const contents = format === "ts" ? renderManifest(flags, meta) : renderDeclaration(flags, meta);

await writeFile(out, contents, "utf8");

const count = flags.filter((flag) => flag.archivedAt === null).length;
console.log(`wrote ${out} — ${count} flags for '${applicationKey}'`);
