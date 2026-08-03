import { defineConfig, type Options } from "tsup";

/**
 * Four configs rather than one with four entries, because `banner` is per-config
 * and only the React build may carry `"use client"`.
 *
 * The rule every non-root entry follows: import the root by package name and
 * keep it external. That is what lets a consumer's generated manifest augment
 * `"@cerebro/client"` and have the hooks narrow — a relative import would give
 * `react.d.ts` its own copy of `FlagMap`, and would bundle a second copy of the
 * core so that `instanceof FlagNotFoundError` stopped working across entries.
 */

const SELF = ["@cerebro/client", "@cerebro/client/react", "@cerebro/client/next"];

const shared = {
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  // `build` removes dist once, up front; letting each config clean would have
  // them delete each other's output.
  clean: false,
  // Load-bearing. With splitting on, esbuild hoists shared code into a chunk
  // that carries no directive, and Next reads that as server code imported from
  // a client module.
  splitting: false,
  // `treeshake` runs the esbuild output back through Rollup, which drops
  // module-level directives — "use client" was silently removed, with only a
  // build warning to say so. esbuild's own dead-code elimination is enough for
  // a library this size, and keeping the directive matters more.
  treeshake: false,
  target: "es2022",
  tsconfig: "./tsconfig.json",
} satisfies Options;

export default defineConfig([
  {
    ...shared,
    name: "core",
    entry: { index: "src/index.ts" },
  },
  {
    ...shared,
    name: "react",
    entry: { react: "src/react/index.ts" },
    external: [...SELF, "react", "react-dom"],
    // esbuild treats an unrecognised top-level string literal as a directive
    // prologue and drops it. A banner is prepended verbatim, ahead of even the
    // CJS preamble, so "use client" lands as byte zero of both formats.
    banner: { js: '"use client";' },
  },
  {
    ...shared,
    name: "next",
    // No banner: this entry is server-only. It reaches the provider through
    // "@cerebro/client/react", which stays external so the client boundary
    // survives instead of being inlined into the server chunk.
    entry: { next: "src/next/index.ts" },
    external: [...SELF, "react", "react-dom", "next", /^next\//],
  },
  {
    ...shared,
    name: "cli",
    entry: { codegen: "src/cli/codegen.ts" },
    format: ["esm"],
    dts: false,
    target: "node18",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
