import { warnOnce, type StrictMode } from "./env";
import { FlagNotFoundError, FlagTypeError } from "./errors";
import { describe, matchesType, type FlagManifest, type TypeMismatch } from "./manifest";

/**
 * One ladder, used by `get()`, `useFlag()` and the Next `flag()` helper, so the
 * three can never disagree about what a flag is worth.
 *
 *   1. the live value, if it matches its declared type
 *   2. a live value of the wrong type — throws in development, warns and falls
 *      through in production, because a bad value upstream must not take a
 *      running app down
 *   3. an explicit local default
 *   4. the manifest default, which is what the server itself serves when the
 *      flag is off — a better guess than anything written at the call site
 *   5. the call-site fallback
 *   6. throw
 *
 * With no manifest and no defaults, steps 3 and 4 are empty and this collapses
 * to "the value, or the fallback, or throw" — the behaviour the SDK has always
 * had.
 */
export interface ResolveInput {
  values: Readonly<Record<string, unknown>>;
  /** Keys the last payload got wrong, kept so the read can explain itself. */
  invalid?: Readonly<Record<string, TypeMismatch>>;
  manifest?: FlagManifest;
  defaults?: Readonly<Record<string, unknown>>;
  strict: StrictMode;
}

export function resolveFlag(
  input: ResolveInput,
  key: string,
  fallback: readonly unknown[] = [],
): unknown {
  const { values, invalid, manifest, defaults, strict } = input;
  const entry = manifest?.flags[key];

  const live = values[key];
  if (live !== undefined) {
    if (strict === "off" || entry === undefined || matchesType(entry.type, live)) return live;

    if (strict === "throw") throw new FlagTypeError(key, entry.type, describe(live));
    warnOnce(
      `type:${key}`,
      `Flag '${key}' should be a ${entry.type} but the payload holds a ${describe(live)}. Falling back to the local default.`,
    );
  }

  // A key the last payload got the type wrong for, with no earlier value worth
  // keeping. The payload boundary has already complained; this makes the read
  // complain too, at the component that actually wanted the flag. In production
  // it falls through to the defaults instead.
  const mismatch = invalid?.[key];
  if (mismatch !== undefined && strict === "throw") {
    throw new FlagTypeError(key, mismatch.expected, mismatch.received);
  }

  const local = defaults?.[key];
  if (local !== undefined) return local;

  if (entry !== undefined) return entry.default;

  if (fallback.length > 0) return fallback[0];

  if (mismatch !== undefined) {
    throw new FlagTypeError(key, mismatch.expected, mismatch.received);
  }

  throw new FlagNotFoundError(key);
}
