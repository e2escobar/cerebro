import {
  appUser,
  application,
  applicationEnvironment,
  createClient,
  envPermission,
  environment,
} from "@cerebro/db";
import { app } from "../src/index.ts";

/** Thin harness over `app.request` that remembers the session cookie. */

const url = process.env.TEST_DATABASE_URL as string;
const { db, sql } = createClient(url, { max: 5, onNotice: () => {} });

export { db, sql };

export async function truncateAll(): Promise<void> {
  await sql.unsafe(`
    TRUNCATE TABLE audit_log, promotion, api_key, env_permission,
                   flag_environment, flag, application_environment, application,
                   session, environment, app_user
    RESTART IDENTITY CASCADE
  `);
}

export interface Response<T> {
  status: number;
  body: T;
  headers: Headers;
}

export class ApiClient {
  private cookie: string | null = null;

  async request<T = unknown>(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response<T>> {
    const headers: Record<string, string> = { ...init.headers };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers["Cookie"] = this.cookie;

    const response = await app.request(path, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0] ?? null;

    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return { status: response.status, body: body as T, headers: response.headers };
  }

  get<T = unknown>(path: string, headers?: Record<string, string>) {
    return this.request<T>("GET", path, { headers });
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body });
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body });
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, { body });
  }
  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }

  async login(email: string, password: string) {
    return this.post("/v1/auth/login", { email, password });
  }
}

/** Every fixture has two applications, so isolation is always testable. */
export const APP = "checkout";
export const OTHER_APP = "mobile";

export const ADMIN = { email: "admin@test", password: "admin-password" };
export const DEVELOPER = { email: "dev@test", password: "dev-password" };

/** The seeded world: three ranked environments, an admin and a developer. */
export async function seedWorld(): Promise<void> {
  await truncateAll();

  const [admin] = await db
    .insert(appUser)
    .values({
      email: ADMIN.email,
      name: "Admin",
      passwordHash: await Bun.password.hash(ADMIN.password),
      role: "admin",
    })
    .returning();
  const [developer] = await db
    .insert(appUser)
    .values({
      email: DEVELOPER.email,
      name: "Dev",
      passwordHash: await Bun.password.hash(DEVELOPER.password),
      role: "developer",
    })
    .returning();
  if (!admin || !developer) throw new Error("failed to seed users");

  const envs = await db
    .insert(environment)
    .values([
      { key: "dev", name: "Development", rank: 0 },
      { key: "qa", name: "QA", rank: 1 },
      { key: "prod", name: "Production", rank: 2, isProtected: true },
    ])
    .returning();

  const byKey = new Map(envs.map((e) => [e.key, e.id]));
  const grants: Record<string, ("read" | "write" | "toggle" | "promote")[]> = {
    dev: ["read", "write", "toggle", "promote"],
    qa: ["read", "write", "toggle", "promote"],
    prod: ["read"],
  };

  const apps = await db
    .insert(application)
    .values([
      { key: APP, name: "Checkout", createdBy: admin.id },
      { key: OTHER_APP, name: "Mobile", createdBy: admin.id },
    ])
    .returning();

  await db.insert(applicationEnvironment).values(
    apps.flatMap((app) => envs.map((env) => ({ applicationId: app.id, environmentId: env.id }))),
  );

  await db.insert(envPermission).values(
    Object.entries(grants).flatMap(([key, permissions]) =>
      permissions.map((permission) => ({
        userId: developer.id,
        environmentId: byKey.get(key) as string,
        permission,
        grantedBy: admin.id,
      })),
    ),
  );
}
