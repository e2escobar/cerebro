import { cookies } from "next/headers";

/**
 * The dashboard's only route to the server (spec §2.1). It never imports
 * `@cerebro/core` or `@cerebro/db` — every read and write goes over HTTP with
 * the session cookie forwarded, so there is exactly one authorization path.
 */

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3011";
export const SESSION_COOKIE = "cerebro_session";

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error.code ?? "UNKNOWN";
    this.details = body?.error.details ?? {};
  }
}

async function sessionHeader(): Promise<Record<string, string>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {};
}

async function parse(response: globalThis.Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Next.js cache tag, so a mutation can revalidate exactly what it changed. */
  tags?: string[];
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, tags } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(await sessionHeader()),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Flag state changes out from under us constantly; never serve it stale.
    cache: "no-store",
    ...(tags ? { next: { tags } } : {}),
  });

  const parsed = await parse(response);

  if (!response.ok) {
    throw new ApiError(response.status, parsed as ApiErrorBody | null, response.statusText);
  }

  return parsed as T;
}

/**
 * Logs in against the API and copies its session cookie onto this origin.
 * The value stays opaque here — only the API can verify its signature.
 */
export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await parse(response)) as ApiErrorBody | null;
    return { ok: false, message: body?.error.message ?? "Could not sign in" };
  }

  const setCookie = response.headers.get("set-cookie");
  const value = setCookie?.split(";")[0]?.split("=").slice(1).join("=");
  if (!value) return { ok: false, message: "The server did not return a session" };

  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return { ok: true };
}

export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/v1/auth/logout`, {
    method: "POST",
    headers: await sessionHeader(),
    cache: "no-store",
  }).catch(() => undefined);

  (await cookies()).delete(SESSION_COOKIE);
}
