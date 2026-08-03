import type { FlagTypeName, TypeMismatch } from "./manifest";

export class FlagNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(
      `Flag '${key}' is not available in this environment. It is either not promoted here, archived, or — for a client key — not marked client-safe.`,
    );
    this.name = "FlagNotFoundError";
    this.key = key;
  }
}

/**
 * A flag holds a value of the wrong type. Thrown at the read, not at the
 * payload, so the stack points at the component that cared.
 */
export class FlagTypeError extends Error {
  readonly key: string;
  readonly expected: FlagTypeName;
  readonly received: string;

  constructor(key: string, expected: FlagTypeName, received: string) {
    super(
      `Flag '${key}' should be a ${expected} but the payload holds a ${received}. Re-run cerebro-codegen if the flag's type changed.`,
    );
    this.name = "FlagTypeError";
    this.key = key;
    this.expected = expected;
    this.received = received;
  }
}

/**
 * A payload disagreed with the manifest about one or more flag types. Carries
 * every mismatch rather than the first, because they usually share a cause.
 */
export class ManifestMismatchError extends Error {
  readonly mismatches: readonly TypeMismatch[];

  constructor(mismatches: readonly TypeMismatch[]) {
    const summary = mismatches
      .map(({ key, expected, received }) => `'${key}' should be a ${expected}, got ${received}`)
      .join("; ");
    super(
      `Cerebro returned ${mismatches.length} flag${mismatches.length === 1 ? "" : "s"} that do not match the generated manifest: ${summary}. Re-run cerebro-codegen, or pass strict: "warn" to keep serving the last known-good values.`,
    );
    this.name = "ManifestMismatchError";
    this.mismatches = mismatches;
  }
}
