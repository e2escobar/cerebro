/**
 * Environment colours are a ramp ordered by rank, not a fixed set (see
 * design/direction.md). They run in HUD semantics — information, caution,
 * critical — so a flag visibly heats up as it approaches production, and the
 * last environment is always the brand's orange-red.
 *
 * Expressed as `color-mix` over the three tokens, so inserting `staging`
 * reshades the whole line rather than needing a new colour.
 */
export function envColor(rank: number, total: number): string {
  if (total <= 1 || rank <= 0) return "var(--env-low)";
  if (rank >= total - 1) return "var(--env-high)";

  const t = rank / (total - 1);
  if (t <= 0.5) {
    const low = Math.round((1 - t * 2) * 100);
    return `color-mix(in oklab, var(--env-low) ${low}%, var(--env-mid))`;
  }
  const mid = Math.round((1 - (t - 0.5) * 2) * 100);
  return `color-mix(in oklab, var(--env-mid) ${mid}%, var(--env-high))`;
}

/** Compact display of a flag value, for node labels and matrix cells. */
export function formatValue(value: unknown, type: string): string {
  if (type === "string") return `"${String(value)}"`;
  if (type === "json") return JSON.stringify(value) ?? "null";
  return String(value);
}
