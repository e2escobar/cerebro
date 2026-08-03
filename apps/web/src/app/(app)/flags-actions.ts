"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";

/**
 * Mutations proxy to the API (spec §2.1). Nothing here decides whether an
 * action is allowed — the API does, and its error message is what we show.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; details?: Record<string, unknown> };

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

/** Turns the editor's string into a value of the flag's declared type. */
function parseValue(raw: string, type: string): { value: unknown } | { message: string } {
  switch (type) {
    case "boolean":
      return { value: raw === "true" };
    case "number": {
      const value = Number(raw.trim());
      if (raw.trim() === "" || !Number.isFinite(value)) {
        return { message: "Enter a number" };
      }
      return { value };
    }
    case "json":
      try {
        return { value: JSON.parse(raw) as unknown };
      } catch {
        return { message: "This is not valid JSON" };
      }
    default:
      return { value: raw };
  }
}

export async function setFlagValue(
  appKey: string,
  flagKey: string,
  environmentKey: string,
  raw: string,
  type: string,
): Promise<ActionResult> {
  const parsed = parseValue(raw, type);
  if ("message" in parsed) return { ok: false, message: parsed.message };

  return run(
    () =>
      api(`/v1/mgmt/applications/${appKey}/flags/${flagKey}/environments/${environmentKey}/value`, {
        method: "PUT",
        body: { value: parsed.value },
      }),
    [`/apps/${appKey}`, `/apps/${appKey}/flags/${flagKey}`],
  );
}

export async function setFlagEnabled(
  appKey: string,
  flagKey: string,
  environmentKey: string,
  enabled: boolean,
): Promise<ActionResult> {
  return run(
    () =>
      api(`/v1/mgmt/applications/${appKey}/flags/${flagKey}/environments/${environmentKey}/enabled`, {
        method: "PUT",
        body: { enabled },
      }),
    [`/apps/${appKey}`, `/apps/${appKey}/flags/${flagKey}`],
  );
}

export async function promoteFlag(
  appKey: string,
  flagKey: string,
  environmentKey: string,
): Promise<ActionResult> {
  return run(
    () =>
      api(`/v1/mgmt/applications/${appKey}/flags/${flagKey}/environments/${environmentKey}/promote`, {
        method: "POST",
      }),
    [`/apps/${appKey}`, `/apps/${appKey}/flags/${flagKey}`],
  );
}

export async function demoteFlag(appKey: string, flagKey: string, environmentKey: string): Promise<ActionResult> {
  return run(
    () =>
      api(`/v1/mgmt/applications/${appKey}/flags/${flagKey}/environments/${environmentKey}/promote`, {
        method: "DELETE",
      }),
    [`/apps/${appKey}`, `/apps/${appKey}/flags/${flagKey}`],
  );
}

export async function updateFlagMetadata(
  appKey: string,
  flagKey: string,
  patch: { name?: string; description?: string; isClientSafe?: boolean },
): Promise<ActionResult> {
  return run(() => api(`/v1/mgmt/applications/${appKey}/flags/${flagKey}`, { method: "PATCH", body: patch }), [
    "/",
    `/flags/${flagKey}`,
  ]);
}

export async function archiveFlag(appKey: string, flagKey: string, archived: boolean): Promise<ActionResult> {
  return run(
    () =>
      api(`/v1/mgmt/applications/${appKey}/flags/${flagKey}/${archived ? "archive" : "restore"}`, { method: "POST" }),
    [`/apps/${appKey}`, `/apps/${appKey}/flags/${flagKey}`],
  );
}

export interface CreateFlagState {
  message: string | null;
}

export async function createFlag(
  appKey: string,
  _previous: CreateFlagState,
  formData: FormData,
): Promise<CreateFlagState> {
  const type = String(formData.get("type") ?? "boolean");
  const key = String(formData.get("key") ?? "").trim();

  const defaultValue = parseValue(String(formData.get("defaultValue") ?? ""), type);
  if ("message" in defaultValue) return { message: `Default value: ${defaultValue.message}` };

  try {
    await api(`/v1/mgmt/applications/${appKey}/flags`, {
      method: "POST",
      body: {
        key,
        name: String(formData.get("name") ?? "").trim(),
        description: String(formData.get("description") ?? ""),
        type,
        defaultValue: defaultValue.value,
        isClientSafe: formData.get("isClientSafe") === "on",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { message: error.message };
    throw error;
  }

  revalidatePath(`/apps/${appKey}`);
  redirect(`/apps/${appKey}/flags/${key}`);
}
