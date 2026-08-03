import { environment, flagEnvironment, promotion } from "@cerebro/db";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { DomainError } from "../src/errors.ts";
import { createFlag, setValue, toggle } from "../src/flags.ts";
import { demoteFlag, listPromotions, promoteFlag } from "../src/promotion.ts";
import { getConfigVersion } from "../src/environments.ts";
import { db, setupFixture, type Fixture } from "./helpers.ts";

/** Spec §5.3 — sequential promotion, guards, and the value-copy source. */

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setupFixture();
});

const app = () => fixture.application.id;

function ctx(actor = fixture.developer) {
  return { db, actor };
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return (error as DomainError).code ?? "UNKNOWN";
  }
}

async function cell(flagKey: string, envKey: string) {
  const [row] = await db
    .select({ fe: flagEnvironment })
    .from(flagEnvironment)
    .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
    .where(eq(environment.key, envKey));
  if (!row) throw new Error(`no row for ${flagKey}/${envKey}`);
  return row.fe;
}

describe("promotion guards", () => {
  beforeEach(async () => {
    await createFlag(ctx(), { applicationId: app(), key: "new-checkout",
      name: "New checkout",
      type: "boolean",
      defaultValue: false,
    });
  });

  test("rejects skipping an environment (dev → prod)", async () => {
    expect(await codeOf(() => promoteFlag(ctx(fixture.admin), app(), "new-checkout", "prod"))).toBe(
      "FLAG_NOT_PROMOTABLE",
    );
  });

  test("allows the sequential path dev → qa → prod", async () => {
    await promoteFlag(ctx(), app(), "new-checkout", "qa");
    await promoteFlag(ctx(fixture.admin), app(), "new-checkout", "prod");
    expect((await cell("new-checkout", "prod")).state).toBe("promoted");
  });

  test("rejects promoting into the base environment", async () => {
    expect(await codeOf(() => promoteFlag(ctx(fixture.admin), app(), "new-checkout", "dev"))).toBe(
      "CANNOT_PROMOTE_INTO_BASE_ENVIRONMENT",
    );
  });

  test("rejects promoting twice", async () => {
    await promoteFlag(ctx(), app(), "new-checkout", "qa");
    expect(await codeOf(() => promoteFlag(ctx(), app(), "new-checkout", "qa"))).toBe("ALREADY_PROMOTED");
  });

  test("rejects promoting an archived flag", async () => {
    const { archiveFlag } = await import("../src/flags.ts");
    await archiveFlag(ctx(fixture.admin), app(), "new-checkout");
    expect(await codeOf(() => promoteFlag(ctx(), app(), "new-checkout", "qa"))).toBe("FLAG_ARCHIVED");
  });

  test("requires the promote permission on the target environment", async () => {
    await promoteFlag(ctx(), app(), "new-checkout", "qa");
    // developer holds only `read` on prod
    expect(await codeOf(() => promoteFlag(ctx(), app(), "new-checkout", "prod"))).toBe("FORBIDDEN");
  });
});

describe("promotion effects", () => {
  test("copies the value from the highest promoted environment below the target", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "max-cart-items",
      name: "Max cart items",
      type: "number",
      defaultValue: 10,
    });

    await setValue(ctx(), app(), "max-cart-items", "dev", 50);
    await promoteFlag(ctx(), app(), "max-cart-items", "qa");
    expect((await cell("max-cart-items", "qa")).value).toBe(50);

    // Change qa, leave dev alone: prod must take qa's value, not dev's.
    await setValue(ctx(), app(), "max-cart-items", "qa", 75);
    await setValue(ctx(), app(), "max-cart-items", "dev", 99);
    await promoteFlag(ctx(fixture.admin), app(), "max-cart-items", "prod");
    expect((await cell("max-cart-items", "prod")).value).toBe(75);
  });

  test("never enables the flag, even when the source is enabled", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "ship-it", name: "Ship it", type: "boolean", defaultValue: false });
    await setValue(ctx(), app(), "ship-it", "dev", true);
    await toggle(ctx(), app(), "ship-it", "dev", true);

    await promoteFlag(ctx(), app(), "ship-it", "qa");
    const qa = await cell("ship-it", "qa");
    expect(qa.state).toBe("promoted");
    expect(qa.enabled).toBe(false);
    expect(qa.value).toBe(true);
    expect(qa.promotedAt).not.toBeNull();
  });

  test("bumps only the target environment's config version", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "ver-flag", name: "Ver", type: "boolean", defaultValue: false });
    const versions = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(fixture.environments).map(
            async ([key, env]) => [key, await getConfigVersion(db, app(), env.id)] as const,
          ),
        ),
      );

    const before = await versions();
    await promoteFlag(ctx(), app(), "ver-flag", "qa");
    const after = await versions();

    expect(after.qa).toBe((before.qa ?? 0) + 1);
    expect(after.dev).toBe(before.dev);
    expect(after.prod).toBe(before.prod);
  });

  test("records promotion history, starting with a null source at creation", async () => {
    const created = await createFlag(ctx(), { applicationId: app(), key: "hist",
      name: "Hist",
      type: "boolean",
      defaultValue: false,
    });
    await promoteFlag(ctx(), app(), "hist", "qa");

    const history = await listPromotions(db, created.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.fromEnv).toBeNull();
    expect(history[0]?.toEnv).toBe("dev");
    expect(history[1]?.fromEnv).toBe("dev");
    expect(history[1]?.toEnv).toBe("qa");

    const rows = await db.select().from(promotion).where(eq(promotion.flagId, created.id));
    expect(rows).toHaveLength(2);
  });
});

describe("demotion", () => {
  beforeEach(async () => {
    await createFlag(ctx(), { applicationId: app(), key: "demo-flag", name: "Demo", type: "boolean", defaultValue: false });
    await promoteFlag(ctx(), app(), "demo-flag", "qa");
  });

  test("is admin only", async () => {
    expect(await codeOf(() => demoteFlag(ctx(), app(), "demo-flag", "qa"))).toBe("FORBIDDEN");
  });

  test("resets state and enabled, and bumps the version", async () => {
    await toggle(ctx(), app(), "demo-flag", "qa", true);
    await demoteFlag(ctx(fixture.admin), app(), "demo-flag", "qa");

    const qa = await cell("demo-flag", "qa");
    expect(qa.state).toBe("not_promoted");
    expect(qa.enabled).toBe(false);
    expect(qa.promotedAt).toBeNull();
  });

  test("is blocked while the flag is promoted higher up", async () => {
    await promoteFlag(ctx(fixture.admin), app(), "demo-flag", "prod");
    expect(await codeOf(() => demoteFlag(ctx(fixture.admin), app(), "demo-flag", "qa"))).toBe(
      "PROMOTED_IN_HIGHER_ENVIRONMENT",
    );

    // Unwind top-down and it succeeds.
    await demoteFlag(ctx(fixture.admin), app(), "demo-flag", "prod");
    await demoteFlag(ctx(fixture.admin), app(), "demo-flag", "qa");
    expect((await cell("demo-flag", "qa")).state).toBe("not_promoted");
  });

  test("rejects demoting where the flag is not promoted", async () => {
    expect(await codeOf(() => demoteFlag(ctx(fixture.admin), app(), "demo-flag", "prod"))).toBe("NOT_PROMOTED");
  });
});
