import type { ErrorBody, FlagDetail } from "@cerebro/contracts";
import { beforeEach, describe, expect, test } from "bun:test";
import { ADMIN, APP, ApiClient, DEVELOPER, OTHER_APP, seedWorld } from "./client.ts";

/** Spec §7.2 — status mapping, session auth, and server-computed capabilities. */

let dev: ApiClient;
let admin: ApiClient;

beforeEach(async () => {
  await seedWorld();
  dev = new ApiClient();
  admin = new ApiClient();
  await dev.login(DEVELOPER.email, DEVELOPER.password);
  await admin.login(ADMIN.email, ADMIN.password);
});

const NEW_FLAG = {
  key: "new-checkout",
  name: "New checkout flow",
  description: "Rewritten cart and payment step",
  type: "boolean",
  defaultValue: false,
  isClientSafe: true,
};

describe("auth", () => {
  test("rejects bad credentials and a disabled account without leaking which", async () => {
    const client = new ApiClient();
    const wrongPassword = await client.login(DEVELOPER.email, "nope");
    const unknownEmail = await client.login("ghost@test", "nope");

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect((wrongPassword.body as ErrorBody).error.message).toBe(
      (unknownEmail.body as ErrorBody).error.message,
    );
  });

  test("/me reports effective permissions per environment", async () => {
    const { status, body } = await dev.get<{
      role: string;
      permissions: { environmentKey: string; permissions: string[] }[];
    }>("/v1/auth/me");

    expect(status).toBe(200);
    expect(body.role).toBe("developer");
    expect(body.permissions.find((p) => p.environmentKey === "prod")?.permissions).toEqual(["read"]);
    expect(body.permissions.find((p) => p.environmentKey === "dev")?.permissions.sort()).toEqual([
      "promote",
      "read",
      "toggle",
      "write",
    ]);
  });

  test("logout invalidates the session", async () => {
    expect((await dev.get(`/v1/mgmt/applications/${APP}/flags`)).status).toBe(200);
    await dev.post("/v1/auth/logout");
    expect((await dev.get(`/v1/mgmt/applications/${APP}/flags`)).status).toBe(401);
  });

  test("the management API refuses anonymous requests", async () => {
    expect((await new ApiClient().get(`/v1/mgmt/applications/${APP}/flags`)).status).toBe(401);
  });
});

describe("flags", () => {
  test("creation returns the full detail with server-computed capabilities", async () => {
    const { status, body } = await dev.post<FlagDetail>(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    expect(status).toBe(201);

    const devEnv = body.environments.find((e) => e.key === "dev");
    const prodEnv = body.environments.find((e) => e.key === "prod");

    expect(devEnv?.state).toBe("promoted");
    expect(devEnv?.canWrite).toBe(true);
    expect(devEnv?.canToggle).toBe(true);
    // Already promoted in dev, so there is nothing to promote into.
    expect(devEnv?.canPromote).toBe(false);

    expect(prodEnv?.state).toBe("not_promoted");
    expect(prodEnv?.canWrite).toBe(false);
    expect(prodEnv?.canToggle).toBe(false);
    expect(prodEnv?.canPromote).toBe(false);

    expect(body.promotions).toHaveLength(1);
    expect(body.promotions[0]?.fromEnv).toBeNull();
  });

  test("domain error codes map onto the documented statuses", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);

    // 409 conflict
    expect((await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG)).status).toBe(409);
    // 400 validation — wrong value type for a boolean flag
    expect(
      (await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/value`, { value: "yes" })).status,
    ).toBe(400);
    // 400 validation — malformed request body
    expect((await dev.post(`/v1/mgmt/applications/${APP}/flags`, { key: "Bad Key" })).status).toBe(400);
    // 404 not found
    expect((await dev.get(`/v1/mgmt/applications/${APP}/flags/does-not-exist`)).status).toBe(404);
    // 422 domain rule — skipping an environment
    expect(
      (await admin.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/prod/promote`)).status,
    ).toBe(422);
    // 403 forbidden — developer has only `read` on prod
    expect((await dev.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/prod/promote`)).status).toBe(
      403,
    );
  });

  test("errors use the documented envelope", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    const { body } = await admin.post<ErrorBody>(
      `/v1/mgmt/applications/${APP}/flags/new-checkout/environments/prod/promote`,
    );

    expect(body.error.code).toBe("FLAG_NOT_PROMOTABLE");
    expect(body.error.message).toContain("qa");
    expect(body.error.details).toBeDefined();
  });

  test("the promotion pipeline runs end to end", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/value`, { value: true });
    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/enabled`, { enabled: true });
    expect((await dev.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/qa/promote`)).status).toBe(200);

    const { body } = await admin.post<FlagDetail>(
      `/v1/mgmt/applications/${APP}/flags/new-checkout/environments/prod/promote`,
    );
    const prod = body.environments.find((e) => e.key === "prod");
    expect(prod?.state).toBe("promoted");
    expect(prod?.value).toBe(true);
    // Promotion never enables (§5.3).
    expect(prod?.enabled).toBe(false);
  });

  test("PATCH cannot change type or key", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.patch(`/v1/mgmt/applications/${APP}/flags/new-checkout`, { name: "Renamed", type: "string", key: "other" });

    const { body } = await dev.get<FlagDetail>(`/v1/mgmt/applications/${APP}/flags/new-checkout`);
    expect(body.name).toBe("Renamed");
    expect(body.type).toBe("boolean");
    expect(body.key).toBe("new-checkout");
  });

  test("demotion is admin only", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/qa/promote`);

    expect((await dev.delete(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/qa/promote`)).status).toBe(403);
    expect((await admin.delete(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/qa/promote`)).status).toBe(200);
  });

  test("listing carries the per-environment matrix and honours filters", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, {
      key: "max-cart-items",
      name: "Max cart items",
      type: "number",
      defaultValue: 10,
    });

    const all = await dev.get<{ items: { key: string; environments: unknown[] }[] }>(
      `/v1/mgmt/applications/${APP}/flags`,
    );
    expect(all.body.items).toHaveLength(2);
    expect(all.body.items[0]?.environments).toHaveLength(3);

    const filtered = await dev.get<{ items: { key: string }[] }>(`/v1/mgmt/applications/${APP}/flags?type=number`);
    expect(filtered.body.items.map((f) => f.key)).toEqual(["max-cart-items"]);

    const searched = await dev.get<{ items: { key: string }[] }>(`/v1/mgmt/applications/${APP}/flags?q=checkout`);
    expect(searched.body.items.map((f) => f.key)).toEqual(["new-checkout"]);
  });

  test("search matches partially and case-insensitively, as type-ahead needs", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, {
      key: "max-cart-items",
      name: "Max cart items",
      type: "number",
      defaultValue: 10,
    });

    const keys = async (query: string) =>
      (await dev.get<{ items: { key: string }[] }>(`/v1/mgmt/applications/${APP}/flags?q=${query}`)).body.items
        .map((f) => f.key)
        .sort();

    // A single letter present in both still matches both — the result set
    // narrows as the query grows, it does not jump straight to one answer.
    expect(await keys("e")).toEqual(["max-cart-items", "new-checkout"]);
    // Then every prefix on the way to "new" keeps matching.
    expect(await keys("ne")).toEqual(["new-checkout"]);
    expect(await keys("new")).toEqual(["new-checkout"]);

    // Mid-word, not just prefixes.
    expect(await keys("cart")).toEqual(["max-cart-items"]);
    // Case-insensitive, and the flag's name counts as well as its key.
    expect(await keys("CHECKOUT")).toEqual(["new-checkout"]);
    expect(await keys("Max%20cart")).toEqual(["max-cart-items"]);

    // A query that matches nothing is empty, not everything.
    expect(await keys("zzz")).toEqual([]);
  });

  test("search combines with the type filter rather than replacing it", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, {
      key: "checkout-limit",
      name: "Checkout limit",
      type: "number",
      defaultValue: 5,
    });

    const both = await dev.get<{ items: { key: string }[] }>(
      `/v1/mgmt/applications/${APP}/flags?q=checkout&type=number`,
    );
    expect(both.body.items.map((f) => f.key)).toEqual(["checkout-limit"]);
  });
});

describe("admin surfaces", () => {
  test("environments are readable by all, writable by admins only", async () => {
    expect((await dev.get("/v1/mgmt/environments")).status).toBe(200);
    expect(
      (await dev.post("/v1/mgmt/environments", { key: "staging", name: "Staging", rank: 3 })).status,
    ).toBe(403);
    expect(
      (await admin.post("/v1/mgmt/environments", { key: "staging", name: "Staging", rank: 3 }))
        .status,
    ).toBe(201);
  });

  test("reordering rejects an order that strands a promoted flag", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/qa/promote`);
    await admin.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/prod/promote`);
    await admin.post("/v1/mgmt/environments", { key: "staging", name: "Staging", rank: 3 });

    const { status, body } = await admin.put<ErrorBody>("/v1/mgmt/environments/order", {
      order: ["dev", "qa", "staging", "prod"],
    });

    expect(status).toBe(422);
    expect(body.error.code).toBe("INVALID_ENVIRONMENT_ORDER");
    expect(JSON.stringify(body.error.details)).toContain("new-checkout");
  });

  test("api keys return the raw key exactly once", async () => {
    const created = await admin.post<{ id: string; key: string; prefix: string }>(
      "/v1/mgmt/api-keys",
      { applicationKey: APP, environmentKey: "prod", name: "Prod server", kind: "server" },
    );

    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^cbr_checkout_prod_[A-Za-z0-9_-]{32}$/);

    const listed = await admin.get<{ items: Record<string, unknown>[] }>("/v1/mgmt/api-keys");
    expect(listed.body.items[0]).not.toHaveProperty("key");
    expect(listed.body.items[0]?.prefix).toBe(created.body.prefix);

    expect((await dev.get("/v1/mgmt/api-keys")).status).toBe(403);
  });

  test("permissions replace wholesale and take effect immediately", async () => {
    const users = await admin.get<{ items: { id: string; email: string }[] }>("/v1/mgmt/users");
    const developerId = users.body.items.find((u) => u.email === DEVELOPER.email)?.id as string;

    await admin.put(`/v1/mgmt/users/${developerId}/permissions`, {
      grants: [{ environmentKey: "prod", permissions: ["read", "write", "toggle", "promote"] }],
    });

    const me = await dev.get<{ permissions: { environmentKey: string; permissions: string[] }[] }>(
      "/v1/auth/me",
    );
    expect(me.body.permissions.find((p) => p.environmentKey === "dev")?.permissions).toEqual([]);
    expect(
      me.body.permissions.find((p) => p.environmentKey === "prod")?.permissions.sort(),
    ).toEqual(["promote", "read", "toggle", "write"]);

    // Losing `write` on dev means losing flag creation, which needs rank 0.
    expect((await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG)).status).toBe(403);
  });

  test("the audit log is readable by any authenticated user and filterable", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, NEW_FLAG);
    await dev.put(`/v1/mgmt/applications/${APP}/flags/new-checkout/environments/dev/enabled`, { enabled: true });

    const { status, body } = await dev.get<{ items: { action: string }[] }>(
      "/v1/mgmt/audit?entityType=flag",
    );
    expect(status).toBe(200);
    expect(body.items.map((i) => i.action)).toEqual(["flag.enabled", "flag.created"]);

    const byEnv = await dev.get<{ items: { action: string }[] }>(
      "/v1/mgmt/audit?environmentKey=dev",
    );
    expect(byEnv.body.items.length).toBeGreaterThan(0);
  });
});

describe("applications", () => {
  const SHARED = {
    key: "new-checkout",
    name: "New checkout",
    type: "boolean",
    defaultValue: false,
  };

  test("the same key may exist in two applications, and is refused twice in one", async () => {
    expect((await dev.post(`/v1/mgmt/applications/${APP}/flags`, SHARED)).status).toBe(201);
    // A different application may take the same key.
    expect((await dev.post(`/v1/mgmt/applications/${OTHER_APP}/flags`, SHARED)).status).toBe(201);
    // The same one may not.
    expect((await dev.post(`/v1/mgmt/applications/${APP}/flags`, SHARED)).status).toBe(409);
  });

  test("listing and reading never cross applications", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, SHARED);

    const mine = await dev.get<{ items: { key: string }[] }>(`/v1/mgmt/applications/${APP}/flags`);
    const theirs = await dev.get<{ items: { key: string }[] }>(
      `/v1/mgmt/applications/${OTHER_APP}/flags`,
    );

    expect(mine.body.items.map((f) => f.key)).toEqual(["new-checkout"]);
    expect(theirs.body.items).toEqual([]);
    // Reading it through the other application is a 404, not someone else's flag.
    expect((await dev.get(`/v1/mgmt/applications/${OTHER_APP}/flags/new-checkout`)).status).toBe(404);
  });

  test("an unknown application is a 404, not an empty list", async () => {
    expect((await dev.get("/v1/mgmt/applications/no-such-app/flags")).status).toBe(404);
  });

  test("creating and deleting applications is admin only", async () => {
    expect((await dev.post("/v1/mgmt/applications", { key: "web", name: "Web" })).status).toBe(403);
    expect((await admin.post("/v1/mgmt/applications", { key: "web", name: "Web" })).status).toBe(201);
    expect((await dev.delete("/v1/mgmt/applications/web")).status).toBe(403);
    expect((await admin.delete("/v1/mgmt/applications/web")).status).toBe(200);
  });

  test("an application cannot be deleted while it owns active flags", async () => {
    await dev.post(`/v1/mgmt/applications/${APP}/flags`, SHARED);

    const blocked = await admin.delete<ErrorBody>(`/v1/mgmt/applications/${APP}`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe("APPLICATION_IN_USE");

    await dev.post(`/v1/mgmt/applications/${APP}/flags/new-checkout/archive`);
    expect((await admin.delete(`/v1/mgmt/applications/${APP}`)).status).toBe(200);
  });
});

