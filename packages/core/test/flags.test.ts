import { auditLog, environment, flagEnvironment } from "@cerebro/db";
import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { DomainError } from "../src/errors.ts";
import {
  archiveFlag,
  createFlag,
  getFlag,
  restoreFlag,
  setValue,
  toggle,
  updateFlag,
} from "../src/flags.ts";
import { getConfigVersion } from "../src/environments.ts";
import { promoteFlag } from "../src/promotion.ts";
import { db, setupFixture, type Fixture } from "./helpers.ts";

/** Spec §5.2 and §5.4. */

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setupFixture();
});

const app = () => fixture.application.id;

function ctx(actor = fixture.developer) {
  return { db, actor };
}

/** Config versions are per (application, environment) now. */
async function versions(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    Object.entries(fixture.environments).map(
      async ([key, env]) => [key, await getConfigVersion(db, app(), env.id)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return (error as DomainError).code ?? "UNKNOWN";
  }
}

describe("createFlag", () => {
  test("creates one flag_environment row per environment, promoted only at rank 0", async () => {
    const created = await createFlag(ctx(), { applicationId: app(), key: "new-checkout",
      name: "New checkout flow",
      type: "boolean",
      defaultValue: false,
    });

    const rows = await db
      .select({ state: flagEnvironment.state, enabled: flagEnvironment.enabled, rank: environment.rank })
      .from(flagEnvironment)
      .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
      .where(eq(flagEnvironment.flagId, created.id));

    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.state === "promoted")).toHaveLength(1);
    expect(rows.find((r) => r.rank === 0)?.state).toBe("promoted");
    expect(rows.find((r) => r.rank === 1)?.state).toBe("not_promoted");
    expect(rows.find((r) => r.rank === 2)?.state).toBe("not_promoted");
    // Creation never enables anything.
    expect(rows.every((r) => r.enabled === false)).toBe(true);
  });

  test("records the initial promotion with a null source and bumps only rank 0", async () => {
    const before = await versions();
    await createFlag(ctx(), { applicationId: app(), key: "f1", name: "F1", type: "string", defaultValue: "off" });
    const after = await versions();

    expect(after.dev).toBe((before.dev ?? 0) + 1);
    expect(after.qa).toBe(before.qa);
    expect(after.prod).toBe(before.prod);

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "flag.created"));
    expect(audit?.entityType).toBe("flag");
  });

  test("initialValue applies to the base environment only", async () => {
    const created = await createFlag(ctx(), { applicationId: app(), key: "max-cart-items",
      name: "Max cart items",
      type: "number",
      defaultValue: 10,
      initialValue: 50,
    });

    const rows = await db
      .select({ value: flagEnvironment.value, rank: environment.rank })
      .from(flagEnvironment)
      .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
      .where(eq(flagEnvironment.flagId, created.id));

    expect(rows.find((r) => r.rank === 0)?.value).toBe(50);
    expect(rows.find((r) => r.rank === 1)?.value).toBe(10);
  });

  test("rejects a duplicate key, a malformed key and a mistyped default", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "dupe", name: "Dupe", type: "boolean", defaultValue: true });

    expect(
      await codeOf(() =>
        createFlag(ctx(), { applicationId: app(), key: "dupe", name: "Dupe", type: "boolean", defaultValue: true }),
      ),
    ).toBe("FLAG_KEY_TAKEN");

    expect(
      await codeOf(() =>
        createFlag(ctx(), { applicationId: app(), key: "Bad Key", name: "x", type: "boolean", defaultValue: true }),
      ),
    ).toBe("VALIDATION_FAILED");

    expect(
      await codeOf(() =>
        createFlag(ctx(), { applicationId: app(), key: "mistyped", name: "x", type: "number", defaultValue: "50" }),
      ),
    ).toBe("INVALID_FLAG_VALUE");
  });

  test("a developer without write on the base environment cannot create", async () => {
    const bare = await setupFixture({ dev: ["read"] });
    expect(
      await codeOf(() =>
        createFlag(
          { db, actor: bare.developer },
          {
            applicationId: bare.application.id,
            key: "nope",
            name: "Nope",
            type: "boolean",
            defaultValue: false,
          },
        ),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("setValue and toggle", () => {
  beforeEach(async () => {
    await createFlag(ctx(), { applicationId: app(), key: "banner", name: "Banner", type: "string", defaultValue: "" });
  });

  test("setValue validates against the declared type and bumps that environment", async () => {
    const devId = fixture.environments.dev?.id as string;
    const before = await getConfigVersion(db, app(), devId);
    await setValue(ctx(), app(), "banner", "dev", "Summer sale");
    const after = await getConfigVersion(db, app(), devId);

    expect(after).toBe(before + 1);
    expect(await codeOf(() => setValue(ctx(), app(), "banner", "dev", 42))).toBe("INVALID_FLAG_VALUE");
  });

  test("setValue is refused without write on that environment", async () => {
    expect(await codeOf(() => setValue(ctx(), app(), "banner", "prod", "x"))).toBe("FORBIDDEN");
  });

  test("toggle sets first_enabled_at once and then leaves it alone", async () => {
    await toggle(ctx(), app(), "banner", "dev", true);
    const [first] = await db
      .select()
      .from(flagEnvironment)
      .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
      .where(eq(environment.key, "dev"));
    const firstEnabledAt = first?.flag_environment.firstEnabledAt;
    expect(firstEnabledAt).not.toBeNull();

    await toggle(ctx(), app(), "banner", "dev", false);
    await toggle(ctx(), app(), "banner", "dev", true);
    const [again] = await db
      .select()
      .from(flagEnvironment)
      .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
      .where(eq(environment.key, "dev"));

    expect(again?.flag_environment.firstEnabledAt?.getTime()).toBe(firstEnabledAt?.getTime());
    expect(again?.flag_environment.enabled).toBe(true);
  });

  test("toggle is refused where the flag is not promoted", async () => {
    expect(await codeOf(() => toggle(ctx(), app(), "banner", "qa", true))).toBe("NOT_PROMOTED");
  });

  test("toggle is refused without the toggle permission", async () => {
    const limited = await setupFixture({ dev: ["read", "write"] });
    await createFlag(
      { db, actor: limited.developer },
      {
        applicationId: limited.application.id,
        key: "b2",
        name: "B2",
        type: "boolean",
        defaultValue: false,
      },
    );
    expect(
      await codeOf(() =>
        toggle({ db, actor: limited.developer }, limited.application.id, "b2", "dev", true),
      ),
    ).toBe("FORBIDDEN");
  });

  test("enable and disable write distinct audit actions", async () => {
    await toggle(ctx(), app(), "banner", "dev", true);
    await toggle(ctx(), app(), "banner", "dev", false);
    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain("flag.enabled");
    expect(actions).toContain("flag.disabled");
  });
});

describe("updateFlag, archive and restore", () => {
  beforeEach(async () => {
    await createFlag(ctx(), { applicationId: app(), key: "meta", name: "Meta", type: "boolean", defaultValue: false });
  });

  test("metadata edits leave versions alone; is_client_safe moves every environment", async () => {
    const before = Object.values(await versions());
    await updateFlag(ctx(), app(), "meta", { name: "Renamed", description: "why" });
    expect(Object.values(await versions())).toEqual(before);

    await updateFlag(ctx(), app(), "meta", { isClientSafe: true });
    expect(Object.values(await versions())).toEqual(before.map((v) => v + 1));
  });

  test("a key change moves every environment's version and is audited as its own event", async () => {
    const before = Object.values(await versions());
    await updateFlag(ctx(), app(), "meta", { key: "meta-2", name: "Renamed" });

    // The payload changed everywhere the flag appears, so every version moves.
    expect(Object.values(await versions())).toEqual(before.map((v) => v + 1));

    const renamed = await getFlag(db, app(), "meta-2");
    expect(renamed.name).toBe("Renamed");
    expect(await codeOf(() => getFlag(db, app(), "meta"))).toBe("FLAG_NOT_FOUND");

    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain("flag.key_changed");
    expect(actions).not.toContain("flag.updated");
  });

  test("a key already in the application is refused, and an invalid one too", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "taken", name: "Taken", type: "boolean", defaultValue: false });

    expect(await codeOf(() => updateFlag(ctx(), app(), "meta", { key: "taken" }))).toBe("FLAG_KEY_TAKEN");
    expect(await codeOf(() => updateFlag(ctx(), app(), "meta", { key: "Not A Key" }))).toBe("VALIDATION_FAILED");

    // Neither attempt touched the flag.
    expect((await getFlag(db, app(), "meta")).key).toBe("meta");
  });

  test("a developer cannot rename a flag promoted above the base environment", async () => {
    await promoteFlag(ctx(), app(), "meta", "qa");
    expect(await codeOf(() => updateFlag(ctx(), app(), "meta", { key: "meta-2" }))).toBe("FORBIDDEN");
    // ...but an admin can.
    await updateFlag(ctx(fixture.admin), app(), "meta", { key: "meta-2" });
    expect((await getFlag(db, app(), "meta-2")).id).toBeString();
  });

  test("archive then restore round-trips and rejects the wrong state", async () => {
    await archiveFlag(ctx(), app(), "meta");
    expect(await codeOf(() => archiveFlag(ctx(), app(), "meta"))).toBe("FLAG_ARCHIVED");
    expect(await codeOf(() => setValue(ctx(), app(), "meta", "dev", true))).toBe("FLAG_ARCHIVED");

    await restoreFlag(ctx(), app(), "meta");
    expect(await codeOf(() => restoreFlag(ctx(), app(), "meta"))).toBe("FLAG_NOT_ARCHIVED");
  });

  test("a developer cannot archive a flag promoted above the base environment", async () => {
    await promoteFlag(ctx(), app(), "meta", "qa");
    expect(await codeOf(() => archiveFlag(ctx(), app(), "meta"))).toBe("FORBIDDEN");
    // ...but an admin can.
    await archiveFlag(ctx(fixture.admin), app(), "meta");
  });
});

describe("audit", () => {
  test("every mutation writes exactly one row", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "a1", name: "A1", type: "boolean", defaultValue: false });
    await setValue(ctx(), app(), "a1", "dev", true);
    await toggle(ctx(), app(), "a1", "dev", true);
    await promoteFlag(ctx(), app(), "a1", "qa");

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "flag")));

    expect(rows.map((r) => r.action).sort()).toEqual([
      "flag.created",
      "flag.enabled",
      "flag.promoted",
      "flag.value_changed",
    ]);
  });
});
