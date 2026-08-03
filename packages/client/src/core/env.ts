/**
 * Whether to be loud. A wrong flag type should stop a developer immediately and
 * never take down production, so the library needs to know which one it is in —
 * without assuming any particular bundler.
 */

export type Mode = "development" | "production";

/** What to do about a value that does not match its declared type. */
export type StrictMode = "throw" | "warn" | "off";

// Declared locally rather than pulled in from @types/node: this package runs in
// browsers, and typing the whole Node global surface here would let code that
// cannot run there compile without complaint. A module-scoped `declare` shadows
// the real global where one exists, so it stays compatible with both.
declare const process: { env: Record<string, string | undefined> };

function readNodeEnv(): string | undefined {
  try {
    // Written as a bare member expression on purpose: webpack's DefinePlugin,
    // Vite's `define` and the Next compiler all substitute this *textually*.
    // `process.env?.NODE_ENV` is not substituted, and a bare `process` in a
    // plain browser throws ReferenceError — hence the catch.
    return process.env.NODE_ENV;
  } catch {
    return undefined;
  }
}

function looksLocal(): boolean {
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  );
}

/**
 * Explicit setting first, then NODE_ENV, then a localhost check for browsers
 * that were served without one. Anything unrecognised is treated as production:
 * the cost of being quiet when we should have shouted is much lower than the
 * cost of throwing inside a real user's render.
 */
export function detectMode(explicit?: Mode): Mode {
  if (explicit) return explicit;

  const nodeEnv = readNodeEnv();
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "development" || nodeEnv === "test") return "development";

  return looksLocal() ? "development" : "production";
}

/** Loud where a developer will see it, forgiving where a user would. */
export function defaultStrictModeFor(mode?: Mode): StrictMode {
  return detectMode(mode) === "development" ? "throw" : "warn";
}

const warned = new Set<string>();

/**
 * Hooks read flags on every render, so an unconditional warn would bury the
 * console. Each distinct problem is reported once per process.
 */
export function warnOnce(id: string, message: string): void {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[cerebro] ${message}`);
}

/** Test seam — the warning log is process-global. */
export function resetWarnings(): void {
  warned.clear();
}
