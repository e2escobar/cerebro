import { environment, flagEnvironment } from "@cerebro/db";
import { beforeEach, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  reorderEnvironments,
} from "../src/environments.ts";
import type { DomainError } from "../src/errors.ts";
import { createFlag } from "../src/flags.ts";
import { demoteFlag, promoteFlag } from "../src/promotion.ts";
import { db, setupFixture, type Fixture } from "./helpers.ts";

/** Spec §5.2 (backfill), §7.2 (reorder and delete rules). */

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setupFixture();
});

const app = () => fixture.application.id;

function ctx(actor = fixture.admin) {
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

describe("createEnvironment", () => {
  test("backfills a not_promoted row for every existing flag", async () => {
    const created = await createFlag(
      { db, actor: fixture.developer },
      { applicationId: app(), key: "existing-flag", name: "Existing", type: "boolean", defaultValue: false },
    );

    const staging = await createEnvironment(ctx(), { key: "staging", name: "Staging", rank: 3 });

    const [row] = await db
      .select()
      .from(flagEnvironment)
      .where(eq(flagEnvironment.environmentId, staging.id));

    expect(row?.flagId).toBe(created.id);
    expect(row?.state).toBe("not_promoted");
    expect(row?.enabled).toBe(false);
    expect(row?.value).toBe(false);
  });

  test("is admin only and rejects duplicate keys, taken ranks and bad keys", async () => {
    expect(
      await codeOf(() =>
        createEnvironment({ db, actor: fixture.developer }, { key: "nope", name: "N", rank: 9 }),
      ),
    ).toBe("FORBIDDEN");

    expect(await codeOf(() => createEnvironment(ctx(), { key: "qa", name: "Q", rank: 9 }))).toBe(
      "ENVIRONMENT_KEY_TAKEN",
    );
    expect(await codeOf(() => createEnvironment(ctx(), { key: "other", name: "O", rank: 1 }))).toBe(
      "ENVIRONMENT_RANK_TAKEN",
    );
    expect(await codeOf(() => createEnvironment(ctx(), { key: "Bad Key", name: "B", rank: 9 }))).toBe(
      "VALIDATION_FAILED",
    );
  });
});

describe("reorderEnvironments", () => {
  test("reassigns ranks when no flag state is violated", async () => {
    await createEnvironment(ctx(), { key: "staging", name: "Staging", rank: 3 });
    const updated = await reorderEnvironments(ctx(), ["dev", "qa", "staging", "prod"]);

    expect(updated.map((e) => e.key)).toEqual(["dev", "qa", "staging", "prod"]);
    expect(updated.map((e) => e.rank)).toEqual([0, 1, 2, 3]);
  });

  test("rejects an order that strands a promoted flag above an unpromoted environment", async () => {
    await createFlag(
      { db, actor: fixture.developer },
      { applicationId: app(), key: "prod-flag", name: "Prod flag", type: "boolean", defaultValue: false },
    );
    await promoteFlag({ db, actor: fixture.developer }, app(), "prod-flag", "qa");
    await promoteFlag(ctx(), app(), "prod-flag", "prod");

    // Inserting staging below prod leaves prod promoted above an unpromoted staging.
    await createEnvironment(ctx(), { key: "staging", name: "Staging", rank: 3 });

    const code = await codeOf(() => reorderEnvironments(ctx(), ["dev", "qa", "staging", "prod"]));
    expect(code).toBe("INVALID_ENVIRONMENT_ORDER");

    try {
      await reorderEnvironments(ctx(), ["dev", "qa", "staging", "prod"]);
    } catch (error) {
      const details = (error as DomainError).details as {
        violations: { flag: string; environments: string[] }[];
      };
      expect(details.violations[0]?.flag).toBe("prod-flag");
      expect(details.violations[0]?.environments).toContain("prod");
    }

    // Ranks are untouched after the rejection.
    const unchanged = await listEnvironments(db);
    expect(unchanged.map((e) => e.key)).toEqual(["dev", "qa", "prod", "staging"]);
  });

  test("rejects an order that omits or invents an environment", async () => {
    expect(await codeOf(() => reorderEnvironments(ctx(), ["dev", "qa"]))).toBe(
      "INVALID_ENVIRONMENT_ORDER",
    );
    expect(await codeOf(() => reorderEnvironments(ctx(), ["dev", "qa", "prod", "ghost"]))).toBe(
      "INVALID_ENVIRONMENT_ORDER",
    );
  });

  test("is admin only", async () => {
    expect(
      await codeOf(() =>
        reorderEnvironments({ db, actor: fixture.developer }, ["dev", "qa", "prod"]),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("deleteEnvironment", () => {
  test("is blocked while a flag is promoted there, and allowed once demoted", async () => {
    await createFlag(
      { db, actor: fixture.developer },
      { applicationId: app(), key: "blocker", name: "Blocker", type: "boolean", defaultValue: false },
    );
    await promoteFlag({ db, actor: fixture.developer }, app(), "blocker", "qa");

    expect(await codeOf(() => deleteEnvironment(ctx(), "qa"))).toBe("ENVIRONMENT_IN_USE");

    await demoteFlag(ctx(), app(), "blocker", "qa");
    await deleteEnvironment(ctx(), "qa");

    const remaining = await db.select().from(environment).orderBy(asc(environment.rank));
    expect(remaining.map((e) => e.key)).toEqual(["dev", "prod"]);
  });
});
