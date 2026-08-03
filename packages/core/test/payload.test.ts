import { beforeEach, describe, expect, test } from "bun:test";
import { archiveFlag, createFlag, setValue, toggle, updateFlag } from "../src/flags.ts";
import { buildEvaluationPayload } from "../src/payload.ts";
import { promoteFlag } from "../src/promotion.ts";
import { db, setupFixture, type Fixture } from "./helpers.ts";

/** Spec §5.5 — the full resolution matrix. */

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setupFixture();
});

const app = () => fixture.application.id;

function ctx(actor = fixture.developer) {
  return { db, actor };
}

const envId = (key: string) => fixture.environments[key]?.id as string;

describe("buildEvaluationPayload", () => {
  test("omits a flag that is not promoted in that environment", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "alpha-flag", name: "Alpha", type: "boolean", defaultValue: false });

    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({ "alpha-flag": false });
    expect(await buildEvaluationPayload(db, app(), envId("qa"))).toEqual({});
    expect(await buildEvaluationPayload(db, app(), envId("prod"))).toEqual({});
  });

  test("returns the environment value when enabled, the default when disabled", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "banner-copy",
      name: "Banner",
      type: "string",
      defaultValue: "Welcome",
      initialValue: "Summer sale",
    });

    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({ "banner-copy": "Welcome" });

    await toggle(ctx(), app(), "banner-copy", "dev", true);
    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({
      "banner-copy": "Summer sale",
    });

    await toggle(ctx(), app(), "banner-copy", "dev", false);
    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({ "banner-copy": "Welcome" });
  });

  test("every declared type resolves to its own shape", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "bool-flag", name: "Bool", type: "boolean", defaultValue: false, initialValue: true });
    await createFlag(ctx(), { applicationId: app(), key: "str-flag", name: "Str", type: "string", defaultValue: "", initialValue: "hi" });
    await createFlag(ctx(), { applicationId: app(), key: "num-flag", name: "Num", type: "number", defaultValue: 0, initialValue: 42 });
    await createFlag(ctx(), { applicationId: app(), key: "json-flag",
      name: "Json",
      type: "json",
      defaultValue: {},
      initialValue: { tier: "b", discount: 0.1 },
    });

    for (const key of ["bool-flag", "str-flag", "num-flag", "json-flag"]) {
      await toggle(ctx(), app(), key, "dev", true);
    }

    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({
      "bool-flag": true,
      "str-flag": "hi",
      "num-flag": 42,
      "json-flag": { tier: "b", discount: 0.1 },
    });
  });

  test("payloads differ per environment for the same flag set", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "max-cart-items",
      name: "Max",
      type: "number",
      defaultValue: 10,
      initialValue: 50,
    });
    await toggle(ctx(), app(), "max-cart-items", "dev", true);
    await promoteFlag(ctx(), app(), "max-cart-items", "qa");

    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({ "max-cart-items": 50 });
    // Promoted but not enabled in qa → the default.
    expect(await buildEvaluationPayload(db, app(), envId("qa"))).toEqual({ "max-cart-items": 10 });
  });

  test("clientOnly hides flags that are not client-safe", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "public-one",
      name: "Public",
      type: "boolean",
      defaultValue: true,
      isClientSafe: true,
    });
    await createFlag(ctx(), { applicationId: app(), key: "secret-one", name: "Secret", type: "boolean", defaultValue: true });

    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({
      "public-one": true,
      "secret-one": true,
    });
    expect(await buildEvaluationPayload(db, app(), envId("dev"), { clientOnly: true })).toEqual({
      "public-one": true,
    });

    await updateFlag(ctx(), app(), "secret-one", { isClientSafe: true });
    expect(await buildEvaluationPayload(db, app(), envId("dev"), { clientOnly: true })).toEqual({
      "public-one": true,
      "secret-one": true,
    });
  });

  test("archived flags disappear from every payload", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "gone", name: "Gone", type: "boolean", defaultValue: true });
    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({ gone: true });

    await archiveFlag(ctx(fixture.admin), app(), "gone");
    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({});
  });

  test("a value edit is invisible while the flag is disabled", async () => {
    await createFlag(ctx(), { applicationId: app(), key: "quiet", name: "Quiet", type: "number", defaultValue: 1 });
    await setValue(ctx(), app(), "quiet", "dev", 999);
    expect(await buildEvaluationPayload(db, app(), envId("dev"))).toEqual({ quiet: 1 });
  });
});
