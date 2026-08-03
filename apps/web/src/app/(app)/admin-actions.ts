"use server";

import type { CreatedApiKey, EnvPermissionInput } from "@cerebro/contracts";
import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api-client";
import type { ActionResult } from "./flags-actions";

/** Admin mutations. The API enforces admin-only; these just proxy and report. */

async function run(fn: () => Promise<unknown>, paths: string[]): Promise<ActionResult> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message, details: error.details };
    }
    throw error;
  }
  for (const path of paths) revalidatePath(path);
  return { ok: true };
}

/* ── applications ──────────────────────────────────────────────────────── */

export async function createApplication(input: {
  key: string;
  name: string;
  description?: string;
}): Promise<ActionResult> {
  return run(() => api("/v1/mgmt/applications", { method: "POST", body: input }), [
    "/",
    "/applications",
  ]);
}

export async function updateApplication(
  key: string,
  patch: { name?: string; description?: string },
): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/applications/${key}`, { method: "PATCH", body: patch }), [
    "/",
    "/applications",
    `/apps/${key}`,
  ]);
}

export async function deleteApplication(key: string): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/applications/${key}`, { method: "DELETE" }), [
    "/",
    "/applications",
  ]);
}

/* ── environments ──────────────────────────────────────────────────────── */

export async function createEnvironment(input: {
  key: string;
  name: string;
  rank: number;
  isProtected: boolean;
}): Promise<ActionResult> {
  return run(() => api("/v1/mgmt/environments", { method: "POST", body: input }), [
    "/",
    "/environments",
  ]);
}

export async function updateEnvironment(
  key: string,
  patch: { name?: string; isProtected?: boolean },
): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/environments/${key}`, { method: "PATCH", body: patch }), [
    "/",
    "/environments",
  ]);
}

export async function reorderEnvironments(order: string[]): Promise<ActionResult> {
  return run(() => api("/v1/mgmt/environments/order", { method: "PUT", body: { order } }), [
    "/",
    "/environments",
  ]);
}

export async function deleteEnvironment(key: string): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/environments/${key}`, { method: "DELETE" }), [
    "/",
    "/environments",
  ]);
}

/* ── api keys ──────────────────────────────────────────────────────────── */

export type CreateKeyResult =
  | { ok: true; key: CreatedApiKey }
  | { ok: false; message: string };

export async function createApiKey(input: {
  applicationKey: string;
  environmentKey: string;
  name: string;
  kind: "server" | "client";
}): Promise<CreateKeyResult> {
  try {
    const key = await api<CreatedApiKey>("/v1/mgmt/api-keys", { method: "POST", body: input });
    revalidatePath("/keys");
    return { ok: true, key };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function revokeApiKey(id: string): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/api-keys/${id}`, { method: "DELETE" }), ["/keys"]);
}

/* ── users and permissions ─────────────────────────────────────────────── */

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: "admin" | "developer";
}): Promise<ActionResult> {
  return run(() => api("/v1/mgmt/users", { method: "POST", body: input }), ["/team"]);
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: "admin" | "developer"; disabled?: boolean },
): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/users/${id}`, { method: "PATCH", body: patch }), ["/team"]);
}

export async function setUserPermissions(
  id: string,
  grants: { environmentKey: string; permissions: EnvPermissionInput[] }[],
): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/users/${id}/permissions`, { method: "PUT", body: { grants } }), [
    "/team",
  ]);
}
