import { beforeEach, describe, expect, test } from "bun:test";
import {
  createApplication,
  deleteApplication,
  getApplicationByKey,
  listApplications,
  updateApplication,
} from "../src/applications.ts";
import { createApiKey, resolveKey } from "../src/api-keys.ts";
import type { DomainError } from "../src/errors.ts";
import { archiveFlag, createFlag, setValue, toggle } from "../src/flags.ts";
import { buildEvaluationPayload } from "../src/payload.ts";
import { promoteFlag } from "../src/promotion.ts";
import { listFlags } from "../src/queries.ts";
import { db, setupFixture, type Fixture } from "./helpers.ts";

/**
 * Applications partition flags. Two applications may hold the same key, and
 * neither ever sees the other's flags — through the payload, the listing, or
 * an SDK key.
 */

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setupFixture();
});

function ctx(actor = fixture.admin) {
  return { db, actor };
}

const dev = () => fixture.environments.dev?.id as string;
const checkout = () => fixture.application.id;
const mobile = () => fixture.otherApplication.id;

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return (error as DomainError).code ?? "UNKNOWN";
  }
}

describe("the same key in two applications", () => {
  test("is two unrelated flags, with their own types and values", async () => {
    await createFlag(ctx(), {
      applicationId: checkout(),
      key: "new-checkout",
      name: "Checkout rewrite",
      type: "boolean",
      defaultValue: false,
      initialValue: true,
    });

    // Same key, different application, different type entirely.
    await createFlag(ctx(), {
      applicationId: mobile(),
      key: "new-checkout",
      name: "Mobile checkout copy",
      type: "string",
      defaultValue: "old",
      initialValue: "new",
    });

    await toggle(ctx(), checkout(), "new-checkout", "dev", true);

    // Only checkout's is switched on; mobile's is untouched.
    expect(await buildEvaluationPayload(db, checkout(), dev())).toEqual({ "new-checkout": true });
    expect(await buildEvaluationPayload(db, mobile(), dev())).toEqual({ "new-checkout": "old" });

    await toggle(ctx(), mobile(), "new-checkout", "dev", true);
    expect(await buildEvaluationPayload(db, mobile(), dev())).toEqual({ "new-checkout": "new" });
    // Still true, not "new" — the two never crossed.
    expect(await buildEvaluationPayload(db, checkout(), dev())).toEqual({ "new-checkout": true });
  });

  test("a duplicate is only rejected within the same application", async () => {
    const input = {
      key: "shared-name",
      name: "Shared",
      type: "boolean" as const,
      defaultValue: false,
    };

    await createFlag(ctx(), { applicationId: checkout(), ...input });
    // The other application may take the same key.
    await createFlag(ctx(), { applicationId: mobile(), ...input });
    // A second one in the same application may not.
    expect(await codeOf(() => createFlag(ctx(), { applicationId: checkout(), ...input }))).toBe(
      "FLAG_KEY_TAKEN",
    );
  });

  test("promotion and value edits stay inside their own application", async () => {
    for (const applicationId of [checkout(), mobile()]) {
      await createFlag(ctx(), {
        applicationId,
        key: "rollout",
        name: "Rollout",
        type: "number",
        defaultValue: 0,
      });
    }

    await setValue(ctx(), checkout(), "rollout", "dev", 50);
    await promoteFlag(ctx(), checkout(), "rollout", "qa");

    const qa = fixture.environments.qa?.id as string;
    await toggle(ctx(), checkout(), "rollout", "qa", true);

    expect(await buildEvaluationPayload(db, checkout(), qa)).toEqual({ rollout: 50 });
    // Mobile's flag never left dev, so qa has nothing for it.
    expect(await buildEvaluationPayload(db, mobile(), qa)).toEqual({});
  });

  test("listing only ever returns one application's flags", async () => {
    await createFlag(ctx(), {
      applicationId: checkout(),
      key: "only-here",
      name: "Only here",
      type: "boolean",
      defaultValue: false,
    });

    const mine = await listFlags(db, { applicationId: checkout() });
    const theirs = await listFlags(db, { applicationId: mobile() });

    expect(mine.items.map((f) => f.key)).toEqual(["only-here"]);
    expect(theirs.items).toEqual([]);
  });

  test("archiving one leaves the other alone", async () => {
    for (const applicationId of [checkout(), mobile()]) {
      await createFlag(ctx(), {
        applicationId,
        key: "doomed",
        name: "Doomed",
        type: "boolean",
        defaultValue: true,
      });
    }

    await archiveFlag(ctx(), checkout(), "doomed");

    expect(await buildEvaluationPayload(db, checkout(), dev())).toEqual({});
    expect(await buildEvaluationPayload(db, mobile(), dev())).toEqual({ doomed: true });
  });
});

describe("SDK keys", () => {
  test("resolve to an application as well as an environment", async () => {
    const { rawKey } = await createApiKey(ctx(), {
      applicationKey: "checkout",
      environmentKey: "dev",
      name: "Checkout server",
      kind: "server",
    });

    const resolved = await resolveKey(db, rawKey);
    expect(resolved?.application.key).toBe("checkout");
    expect(resolved?.environment.key).toBe("dev");
    expect(rawKey).toMatch(/^cbr_checkout_dev_/);
  });

  test("a key for one application cannot see another's flags", async () => {
    await createFlag(ctx(), {
      applicationId: mobile(),
      key: "mobile-only",
      name: "Mobile only",
      type: "boolean",
      defaultValue: true,
    });

    const { rawKey } = await createApiKey(ctx(), {
      applicationKey: "checkout",
      environmentKey: "dev",
      name: "Checkout server",
      kind: "server",
    });
    const resolved = await resolveKey(db, rawKey);

    const payload = await buildEvaluationPayload(
      db,
      resolved?.application.id as string,
      resolved?.environment.id as string,
    );
    expect(payload).toEqual({});
  });
});

describe("managing applications", () => {
  test("requires an admin", async () => {
    expect(
      await codeOf(() =>
        createApplication({ db, actor: fixture.developer }, { key: "web", name: "Web" }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("rejects a malformed or duplicate key", async () => {
    expect(await codeOf(() => createApplication(ctx(), { key: "Bad Key", name: "B" }))).toBe(
      "VALIDATION_FAILED",
    );
    expect(await codeOf(() => createApplication(ctx(), { key: "checkout", name: "Dupe" }))).toBe(
      "APPLICATION_KEY_TAKEN",
    );
  });

  test("a new application starts with a version row per environment", async () => {
    const created = await createApplication(ctx(), { key: "web", name: "Web" });

    // No flags yet, so every environment is simply empty rather than missing.
    for (const env of Object.values(fixture.environments)) {
      expect(await buildEvaluationPayload(db, created.id, env.id)).toEqual({});
    }
    expect((await listApplications(db)).map((a) => a.key)).toEqual(["checkout", "mobile", "web"]);
  });

  test("can be renamed, and is found by key", async () => {
    await updateApplication(ctx(), "checkout", { name: "Checkout Web" });
    expect((await getApplicationByKey(db, "checkout")).name).toBe("Checkout Web");
    expect(await codeOf(() => getApplicationByKey(db, "ghost"))).toBe("APPLICATION_NOT_FOUND");
  });

  test("cannot be deleted while it still owns flags", async () => {
    await createFlag(ctx(), {
      applicationId: checkout(),
      key: "blocker",
      name: "Blocker",
      type: "boolean",
      defaultValue: false,
    });

    expect(await codeOf(() => deleteApplication(ctx(), "checkout"))).toBe("APPLICATION_IN_USE");

    await archiveFlag(ctx(), checkout(), "blocker");
    // Archived flags no longer block it.
    await deleteApplication(ctx(), "checkout");
    expect((await listApplications(db)).map((a) => a.key)).toEqual(["mobile"]);
  });
});
