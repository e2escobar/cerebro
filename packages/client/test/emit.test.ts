import { describe, expect, test } from "bun:test";
import { activeFlags, renderDeclaration, renderManifest, type FlagRecord } from "../src/cli/emit";

/** The generator's output, without a server or a filesystem. */

const meta = {
  application: "checkout",
  source: "http://localhost:3011",
  generatedAt: "2026-08-03T00:00:00.000Z",
};

function flag(overrides: Partial<FlagRecord> & Pick<FlagRecord, "key" | "type">): FlagRecord {
  return {
    name: overrides.key,
    description: "",
    defaultValue: null,
    isClientSafe: true,
    archivedAt: null,
    ...overrides,
  };
}

const records: FlagRecord[] = [
  flag({ key: "new-checkout", type: "boolean", defaultValue: false, name: "New checkout" }),
  flag({ key: "banner-copy", type: "string", defaultValue: "", description: "Promo banner" }),
  flag({ key: "internal-metrics", type: "number", defaultValue: 0, isClientSafe: false }),
  flag({ key: "gone", type: "boolean", defaultValue: false, archivedAt: "2026-01-01T00:00:00Z" }),
];

describe("activeFlags", () => {
  test("drops archived flags and sorts by key", () => {
    // Archived flags are absent from every payload, so a manifest that listed
    // them would report them missing on every load.
    expect(activeFlags(records).map((f) => f.key)).toEqual([
      "banner-copy",
      "internal-metrics",
      "new-checkout",
    ]);
  });
});

describe("renderManifest", () => {
  const output = renderManifest(records, meta);

  test("carries the type, the default and the client-safe bit", () => {
    expect(output).toContain('"banner-copy": { type: "string", default: "", clientSafe: true },');
    expect(output).toContain(
      '"internal-metrics": { type: "number", default: 0, clientSafe: false },',
    );
    expect(output).toContain('"new-checkout": { type: "boolean", default: false, clientSafe: true },');
    expect(output).not.toContain('"gone"');
  });

  test("declares the augmentation against the package, not a relative path", () => {
    expect(output).toContain('declare module "@cerebro/client"');
    expect(output).toContain("interface FlagMap extends InferFlagMap<typeof manifest> {}");
  });

  test("pins the value shape so InferFlagMap can read the literal types", () => {
    expect(output).toContain("as const satisfies FlagManifest");
  });

  test("uses the description as the doc comment, falling back to the name", () => {
    expect(output).toContain("/** Promo banner */");
    expect(output).toContain("/** New checkout */");
  });

  test("escapes a description that would close the comment", () => {
    const output = renderManifest([flag({ key: "a", type: "string", description: "ends */ here" })], meta);

    expect(output).toContain("/** ends *\\/ here */");
  });

  test("serializes a json default as a literal", () => {
    const output = renderManifest(
      [flag({ key: "pricing-rules", type: "json", defaultValue: { tiers: [1, 2] } })],
      meta,
    );

    expect(output).toContain('default: {"tiers":[1,2]}');
  });
});

describe("renderDeclaration", () => {
  const output = renderDeclaration(records, meta);

  test("maps flag types to TypeScript, with json as unknown", () => {
    expect(output).toContain('"banner-copy": string;');
    expect(output).toContain('"internal-metrics": number;');
    expect(output).toContain('"new-checkout": boolean;');
    expect(renderDeclaration([flag({ key: "rules", type: "json" })], meta)).toContain(
      '"rules": unknown;',
    );
  });

  test("augments the package and carries no runtime value", () => {
    expect(output).toContain('declare module "@cerebro/client"');
    expect(output).not.toContain("export const manifest");
  });
});
