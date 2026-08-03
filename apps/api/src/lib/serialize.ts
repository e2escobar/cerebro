/** Timestamps serialize as ISO 8601 UTC strings (spec §12). */

export function iso(date: Date): string;
export function iso(date: Date | null | undefined): string | null;
export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}
