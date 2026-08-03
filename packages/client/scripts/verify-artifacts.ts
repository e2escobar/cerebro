/**
 * Checks the built package for the three things that break silently.
 *
 * Every one of these has the same failure mode: the build succeeds, the types
 * check, the tests pass, and the package is wrong only once someone installs
 * it. So they are asserted against `dist/`, not against source.
 *
 *   bun run verify:artifacts     (after bun run build)
 */

import { readFile } from "node:fs/promises";

const failures: string[] = [];

async function read(path: string): Promise<string> {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  } catch {
    failures.push(`${path} is missing — run \`bun run build\` first`);
    return "";
  }
}

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label} — ${detail}`);
  }
}

console.log("\nCerebro client artifact check\n");

// 1. The React entry must announce itself as a client module, in both formats.
//    esbuild drops top-level directives, and a Rollup pass drops the banner
//    that puts them back, so this has been wrong once already.
for (const file of ["dist/react.js", "dist/react.cjs"]) {
  const source = await read(file);
  check(
    `${file} starts with "use client"`,
    source.startsWith('"use client";'),
    `first line was: ${JSON.stringify(source.split("\n")[0] ?? "")}`,
  );
}

// 2. The Next entry is server code. A stray directive there would push the
//    server-only snapshot loader into the client bundle.
for (const file of ["dist/next.js", "dist/next.cjs"]) {
  const source = await read(file);
  check(`${file} is not marked "use client"`, !source.startsWith('"use client";'), "it is");
}

// 3. The provider has to stay behind a real module boundary. Inlined into the
//    server chunk it would lose its directive, and Next would treat a client
//    component as server code.
for (const file of ["dist/next.js", "dist/next.cjs"]) {
  const source = await read(file);
  check(
    `${file} imports the provider from "@cerebro/client/react"`,
    /['"]@cerebro\/client\/react['"]/.test(source),
    "the React entry was bundled into the server chunk instead of imported",
  );
}

// 4. The flag map is declared once, in the root entry, and imported by the
//    others. If a declaration bundler inlines it instead, everything still
//    compiles and `useFlag()` silently returns `unknown` forever.
const rootTypes = await read("dist/index.d.ts");
check(
  "dist/index.d.ts declares FlagMap",
  /\binterface FlagMap\b/.test(rootTypes),
  "the root entry no longer declares it",
);

for (const file of ["dist/react.d.ts", "dist/react.d.cts", "dist/next.d.ts", "dist/next.d.cts"]) {
  const types = await read(file);
  check(
    `${file} imports from "@cerebro/client" rather than redeclaring FlagMap`,
    /from ['"]@cerebro\/client['"]/.test(types) && !/\binterface FlagMap\b/.test(types),
    "it inlined the root entry's declarations — a consumer's generated manifest will not reach this entry",
  );
}

// 5. The bin has to be executable by npx, which means a Node shebang.
const cli = await read("dist/codegen.js");
check(
  "dist/codegen.js has a node shebang",
  cli.startsWith("#!/usr/bin/env node"),
  `first line was: ${JSON.stringify(cli.split("\n")[0] ?? "")}`,
);

if (failures.length > 0) {
  console.error("\nfailed:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error("");
  process.exit(1);
}

console.log("\npassed\n");
