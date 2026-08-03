/**
 * The generated manifest: what `cerebro-codegen` knows about an application's
 * flags, in a form that is both a runtime value and a source of types.
 *
 * The evaluation API sends resolved values with no type information, so this is
 * the only thing on the client side that knows a flag is supposed to be a
 * number. It is what makes local validation possible at all.
 */

export type FlagTypeName = "boolean" | "string" | "number" | "json";

export type JsonValue =
  | boolean
  | string
  | number
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface FlagManifestEntry {
  readonly type: FlagTypeName;
  /** The flag's server-side default — what an environment returns when it is off. */
  readonly default: JsonValue;
  /** False for flags a client key never receives. Used to keep them out of HTML. */
  readonly clientSafe?: boolean;
}

export interface FlagManifest {
  readonly version: 1;
  readonly application: string;
  readonly generatedAt: string;
  readonly source?: string;
  readonly flags: { readonly [key: string]: FlagManifestEntry };
}

type ValueOfName<T extends FlagTypeName> = T extends "boolean"
  ? boolean
  : T extends "string"
    ? string
    : T extends "number"
      ? number
      : unknown;

/**
 * Derives the flag map from the manifest value, so the generated file has one
 * source of truth rather than a table of types that can drift from the table of
 * defaults sitting next to it.
 *
 *   declare module "@cerebro/client" {
 *     interface FlagMap extends InferFlagMap<typeof manifest> {}
 *   }
 */
export type InferFlagMap<
  M extends { readonly flags: { readonly [key: string]: { readonly type: FlagTypeName } } },
> = {
  -readonly [K in keyof M["flags"]]: ValueOfName<M["flags"][K]["type"]>;
};

/**
 * Mirrors `validateValue` in `packages/core/src/flag-value.ts` — booleans,
 * strings, finite numbers, and anything defined for `json`. The two have to
 * agree, or the client rejects values the server considers legal.
 */
export function matchesType(type: FlagTypeName, value: unknown): boolean {
  switch (type) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "json":
      return value !== undefined;
  }
}

/** How the server describes a rejected value, so both sides read the same. */
export function describe(value: unknown): string {
  return value === null ? "null" : typeof value;
}

export interface TypeMismatch {
  key: string;
  expected: FlagTypeName;
  received: string;
}

export interface SnapshotIssues {
  /** In the payload, absent from the manifest — the manifest is stale. */
  unknownKeys: string[];
  /** In the manifest, absent from the payload — usually just not promoted here. */
  missingKeys: string[];
  /** Present, but not the declared type. The only kind that is ever fatal. */
  typeMismatches: TypeMismatch[];
}

/**
 * Compares a payload against the manifest. Exported so it can be used on its
 * own — in a test, or as a startup healthcheck — without constructing a client.
 */
export function validateSnapshot(
  values: Readonly<Record<string, unknown>>,
  manifest: FlagManifest,
): SnapshotIssues {
  const unknownKeys: string[] = [];
  const missingKeys: string[] = [];
  const typeMismatches: TypeMismatch[] = [];

  for (const [key, value] of Object.entries(values)) {
    const entry = manifest.flags[key];
    if (entry === undefined) {
      unknownKeys.push(key);
    } else if (!matchesType(entry.type, value)) {
      typeMismatches.push({ key, expected: entry.type, received: describe(value) });
    }
  }

  for (const key of Object.keys(manifest.flags)) {
    if (!(key in values)) missingKeys.push(key);
  }

  return { unknownKeys, missingKeys, typeMismatches };
}

export function hasIssues(issues: SnapshotIssues): boolean {
  return (
    issues.unknownKeys.length > 0 ||
    issues.missingKeys.length > 0 ||
    issues.typeMismatches.length > 0
  );
}
