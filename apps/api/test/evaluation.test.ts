import { beforeEach, describe, expect, test } from "bun:test";
import { clearCache } from "../src/evaluation/cache.ts";
import { ADMIN, APP, ApiClient, DEVELOPER, OTHER_APP, seedWorld } from "./client.ts";

/** Spec §7.1 and §9 — payload shape, filtering, ETag caching, key auth. */

let dev: ApiClient;
let admin: ApiClient;
let anon: ApiClient;

async function newKey(
  environmentKey: string,
  kind: "server" | "client",
  applicationKey = APP,
): Promise<string> {
  const { body } = await admin.post<{ key: string }>("/v1/mgmt/api-keys", {
    applicationKey,
    environmentKey,
    name: `${applicationKey}-${environmentKey}-${kind}`,
    kind,
  });
  return body.key;
}

function bearer(key: string) {
  return { Authorization: `Bearer ${key}` };
}

beforeEach(async () => {
  await seedWorld();
  clearCache();
  dev = new ApiClient();
  admin = new ApiClient();
  anon = new ApiClient();
  await dev.login(DEVELOPER.email, DEVELOPER.password);
  await admin.login(ADMIN.email, ADMIN.password);

  await dev.post(`/v1/mgmt/applications/${APP}/flags`, {
    key: "new-checkout",
    name: "New checkout",
    type: "boolean",
    defaultValue: false,
    initialValue: true,
    isClientSafe: true,
  });
  await dev.post(`/v1/mgmt/applications/${APP}/flags`, {
    key: "internal-metrics",
    name: "Internal metrics",
    type: "number",
    defaultValue: 0,
    initialValue: 42,
  });
});

describe("GET /v1/flags", () => {
  test("returns a flat key-value map of resolved values", async () => {
    const key = await newKey("dev", "server");
    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/enabled`, { enabled: true });

    const { status, body } = await anon.get<Record<string, unknown>>("/v1/flags", bearer(key));
    expect(status).toBe(200);
    expect(body).toEqual({ "new-checkout": true, "internal-metrics": 0 });
  });

  test("derives the environment from the key alone", async () => {
    const devKey = await newKey("dev", "server");
    const prodKey = await newKey("prod", "server");

    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/enabled`, { enabled: true });
    await dev.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/qa/promote`);
    await admin.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/prod/promote`);

    const devPayload = await anon.get<Record<string, unknown>>("/v1/flags", bearer(devKey));
    const prodPayload = await anon.get<Record<string, unknown>>("/v1/flags", bearer(prodKey));

    expect(devPayload.body).toEqual({ "new-checkout": true, "internal-metrics": 0 });
    // Promoted but not enabled in prod → the default, and no unpromoted flags.
    expect(prodPayload.body).toEqual({ "new-checkout": false });
  });

  test("a client key omits flags that are not client-safe", async () => {
    const clientKey = await newKey("dev", "client");
    const { body } = await anon.get<Record<string, unknown>>("/v1/flags", bearer(clientKey));

    expect(body).toHaveProperty("new-checkout");
    expect(body).not.toHaveProperty("internal-metrics");
  });

  test("sets the caching headers documented in §7.1", async () => {
    const key = await newKey("dev", "server");
    const { headers } = await anon.get("/v1/flags", bearer(key));

    expect(headers.get("ETag")).toMatch(/^W\/"checkout-dev-\d+"$/);
    expect(headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(Number(headers.get("X-Config-Version"))).toBeGreaterThan(0);
  });

  test("If-None-Match returns 304 with no body until a mutation moves the version", async () => {
    const key = await newKey("dev", "server");
    const first = await anon.get("/v1/flags", bearer(key));
    const etag = first.headers.get("ETag") as string;

    const cached = await anon.get("/v1/flags", { ...bearer(key), "If-None-Match": etag });
    expect(cached.status).toBe(304);
    expect(cached.body).toBeNull();

    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/enabled`, { enabled: true });

    const afterMutation = await anon.get("/v1/flags", { ...bearer(key), "If-None-Match": etag });
    expect(afterMutation.status).toBe(200);
    expect(afterMutation.headers.get("ETag")).not.toBe(etag);
  });

  test("every mutation kind moves the ETag", async () => {
    const key = await newKey("dev", "server");
    const etagNow = async () =>
      (await anon.get("/v1/flags", bearer(key))).headers.get("ETag") as string;

    const initial = await etagNow();
    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/value`, { value: false });
    const afterValue = await etagNow();
    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/enabled`, { enabled: true });
    const afterToggle = await etagNow();
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, {
      key: "third-flag",
      name: "Third",
      type: "string",
      defaultValue: "x",
    });
    const afterCreate = await etagNow();

    expect(new Set([initial, afterValue, afterToggle, afterCreate]).size).toBe(4);
  });
});

describe("GET /v1/config-version", () => {
  test("reports the version and environment for the key", async () => {
    const key = await newKey("qa", "server");
    const { status, body } = await anon.get<{ version: number; environment: string }>(
      "/v1/config-version",
      bearer(key),
    );

    expect(status).toBe(200);
    expect(body.environment).toBe("qa");
    expect(body.version).toBeGreaterThan(0);
  });
});

describe("SDK key authentication", () => {
  test("refuses a missing, malformed, unknown or revoked key", async () => {
    expect((await anon.get("/v1/flags")).status).toBe(401);
    expect((await anon.get("/v1/flags", { Authorization: "Token abc" })).status).toBe(401);
    expect(
      (await anon.get("/v1/flags", bearer("cbr_checkout_dev_notarealkey0000000000"))).status,
    ).toBe(401);

    const key = await newKey("dev", "server");
    const listed = await admin.get<{ items: { id: string }[] }>("/v1/mgmt/api-keys");
    await admin.delete(`/v1/mgmt/api-keys/${listed.body.items[0]?.id}`);

    expect((await anon.get("/v1/flags", bearer(key))).status).toBe(401);
  });

  test("records last_used_at on first use", async () => {
    const key = await newKey("dev", "server");
    await anon.get("/v1/flags", bearer(key));

    const listed = await admin.get<{ items: { lastUsedAt: string | null }[] }>("/v1/mgmt/api-keys");
    expect(listed.body.items[0]?.lastUsedAt).not.toBeNull();
  });
});

describe("applications", () => {
  test("a key only ever serves its own application's flags", async () => {
    await dev.post(`/v1/mgmt/applications/${OTHER_APP}/flags`, {
      key: "mobile-only",
      name: "Mobile only",
      type: "boolean",
      defaultValue: true,
      isClientSafe: true,
    });

    const checkoutKey = await newKey("dev", "server");
    const mobileKey = await newKey("dev", "server", OTHER_APP);

    const checkout = await anon.get<Record<string, unknown>>("/v1/flags", bearer(checkoutKey));
    const mobile = await anon.get<Record<string, unknown>>("/v1/flags", bearer(mobileKey));

    expect(Object.keys(checkout.body).sort()).toEqual(["internal-metrics", "new-checkout"]);
    expect(Object.keys(mobile.body)).toEqual(["mobile-only"]);
  });

  test("the same key in two applications is two independent flags", async () => {
    // `new-checkout` already exists in APP as a boolean.
    await dev.post(`/v1/mgmt/applications/${OTHER_APP}/flags`, {
      key: "new-checkout",
      name: "Mobile checkout",
      type: "string",
      defaultValue: "old",
      initialValue: "new",
    });

    await dev.put(`/v1/mgmt/applications/${OTHER_APP}/flags/new-checkout/environments/dev/enabled`, {
      enabled: true,
    });

    const checkout = await anon.get<Record<string, unknown>>(
      "/v1/flags",
      bearer(await newKey("dev", "server")),
    );
    const mobile = await anon.get<Record<string, unknown>>(
      "/v1/flags",
      bearer(await newKey("dev", "server", OTHER_APP)),
    );

    expect(checkout.body["new-checkout"]).toBe(false);
    expect(mobile.body["new-checkout"]).toBe("new");
  });

  test("one application's release does not move another's ETag", async () => {
    const checkoutKey = await newKey("dev", "server");
    const mobileKey = await newKey("dev", "server", OTHER_APP);

    const mobileEtag = (await anon.get("/v1/flags", bearer(mobileKey))).headers.get("ETag");

    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/enabled`, {
      enabled: true,
    });

    const checkoutAfter = (await anon.get("/v1/flags", bearer(checkoutKey))).headers.get("ETag");
    const mobileAfter = (await anon.get("/v1/flags", bearer(mobileKey))).headers.get("ETag");

    expect(mobileAfter).toBe(mobileEtag);
    expect(checkoutAfter).toContain("checkout-dev");
  });
});
