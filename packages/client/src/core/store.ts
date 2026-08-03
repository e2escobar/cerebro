import {
  matchesType,
  validateSnapshot,
  type FlagManifest,
  type SnapshotIssues,
  type TypeMismatch,
} from "./manifest";

/**
 * The unit React subscribes to.
 *
 * Identity matters more than contents here: `useSyncExternalStore` compares
 * snapshots by reference, so this object is replaced only when something has
 * actually changed. `getAll()` allocates a fresh object on every call, which is
 * fine for a `get()` caller and would spin React forever.
 */
export interface Snapshot {
  readonly values: Readonly<Record<string, unknown>>;
  /** Keys the payload got the type wrong for, so a read can explain itself. */
  readonly invalid: Readonly<Record<string, TypeMismatch>>;
  /** The environment's config version, or null before the first load. */
  readonly version: number | null;
  /** True once real values have arrived — from the network or from the server. */
  readonly ready: boolean;
}

export const EMPTY_SNAPSHOT: Snapshot = Object.freeze({
  values: Object.freeze({}),
  invalid: Object.freeze({}),
  version: null,
  ready: false,
});

export function freezeSnapshot(snapshot: Snapshot): Snapshot {
  return Object.freeze({
    values: Object.freeze({ ...snapshot.values }),
    invalid: Object.freeze({ ...snapshot.invalid }),
    version: snapshot.version,
    ready: snapshot.ready,
  });
}

function isSnapshot(input: object): input is Snapshot {
  return "values" in input && "ready" in input;
}

/**
 * Accepts either a full snapshot — what the Next entry hands over — or the bare
 * key-value map someone serialized themselves.
 */
export function toSnapshot(
  input: Snapshot | Readonly<Record<string, unknown>> | undefined,
): Snapshot {
  if (input === undefined) return EMPTY_SNAPSHOT;
  if (isSnapshot(input)) return freezeSnapshot(input);
  return freezeSnapshot({
    values: input,
    invalid: {},
    version: null,
    ready: Object.keys(input).length > 0,
  });
}

export interface SanitizedPayload {
  values: Record<string, unknown>;
  invalid: Record<string, TypeMismatch>;
  issues: SnapshotIssues | null;
}

/**
 * Applies the manifest to an incoming payload.
 *
 * A key whose type is wrong keeps its last value that did validate, and only
 * that key is affected. Rejecting the whole payload over one bad flag would
 * freeze every other flag in it — a worse outcome than the one being guarded
 * against, and a much harder one to diagnose.
 */
export function sanitize(
  incoming: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>>,
  manifest: FlagManifest | undefined,
): SanitizedPayload {
  if (manifest === undefined) {
    return { values: { ...incoming }, invalid: {}, issues: null };
  }

  const issues = validateSnapshot(incoming, manifest);
  const values = { ...incoming };
  const invalid: Record<string, TypeMismatch> = {};

  for (const mismatch of issues.typeMismatches) {
    invalid[mismatch.key] = mismatch;
    const lastGood = previous[mismatch.key];
    if (lastGood !== undefined && matchesType(mismatch.expected, lastGood)) {
      values[mismatch.key] = lastGood;
    } else {
      delete values[mismatch.key];
    }
  }

  return { values, invalid, issues };
}
