import type { EvaluationPayload } from "@cerebro/core";

/**
 * Per-process payload cache (spec §9). Keyed by config version, so a version
 * bump invalidates implicitly — there is nothing to evict on write. Capped at
 * 100 entries, oldest first. No Redis in v1.
 */

const MAX_ENTRIES = 100;
const entries = new Map<string, EvaluationPayload>();

function cacheKey(environmentId: string, kind: string, configVersion: number): string {
  return `${environmentId}:${kind}:${configVersion}`;
}

export function getCached(
  environmentId: string,
  kind: string,
  configVersion: number,
): EvaluationPayload | undefined {
  return entries.get(cacheKey(environmentId, kind, configVersion));
}

export function setCached(
  environmentId: string,
  kind: string,
  configVersion: number,
  payload: EvaluationPayload,
): void {
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(cacheKey(environmentId, kind, configVersion), payload);
}

/** Test seam. */
export function clearCache(): void {
  entries.clear();
}
