import { beforeEach, describe, expect, test } from "bun:test";
import { can } from "../src/rbac.ts";
import { setupFixture, type Fixture } from "./helpers.ts";

/** Spec §5.6 — admin bypass plus each developer permission. */

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setupFixture();
});

describe("can()", () => {
  test("admin bypasses env_permission for every action", () => {
    const { admin, environments } = fixture;
    expect(can(admin, "environment.create")).toBe(true);
    expect(can(admin, "environment.reorder")).toBe(true);
    expect(can(admin, "api_key.create")).toBe(true);
    expect(can(admin, "user.manage")).toBe(true);
    expect(can(admin, "flag.demote", environments.prod?.id)).toBe(true);
    expect(can(admin, "flag.toggle", environments.prod?.id)).toBe(true);
    expect(can(admin, "flag.promote", environments.prod?.id)).toBe(true);
  });

  test("developers are refused every admin-only action", () => {
    const { developer, environments } = fixture;
    expect(can(developer, "environment.create")).toBe(false);
    expect(can(developer, "environment.update")).toBe(false);
    expect(can(developer, "environment.reorder")).toBe(false);
    expect(can(developer, "environment.delete")).toBe(false);
    expect(can(developer, "api_key.create")).toBe(false);
    expect(can(developer, "api_key.revoke")).toBe(false);
    expect(can(developer, "user.manage")).toBe(false);
    expect(can(developer, "permission.manage")).toBe(false);
    expect(can(developer, "flag.demote", environments.dev?.id)).toBe(false);
  });

  test("each developer permission gates exactly its own action", () => {
    const { developer, environments } = fixture;
    const dev = environments.dev?.id;
    const prod = environments.prod?.id;

    // dev: read, write, toggle, promote
    expect(can(developer, "flag.read", dev)).toBe(true);
    expect(can(developer, "flag.set_value", dev)).toBe(true);
    expect(can(developer, "flag.toggle", dev)).toBe(true);
    expect(can(developer, "flag.promote", dev)).toBe(true);

    // prod: read only
    expect(can(developer, "flag.read", prod)).toBe(true);
    expect(can(developer, "flag.set_value", prod)).toBe(false);
    expect(can(developer, "flag.toggle", prod)).toBe(false);
    expect(can(developer, "flag.promote", prod)).toBe(false);
  });

  test("an environment-scoped action without an environment is refused", () => {
    expect(can(fixture.developer, "flag.toggle")).toBe(false);
    expect(can(fixture.developer, "flag.read")).toBe(false);
  });

  test("audit.read is open to any authenticated user", () => {
    expect(can(fixture.developer, "audit.read")).toBe(true);
    expect(can(fixture.admin, "audit.read")).toBe(true);
  });

  test("a developer with no grants at all can do nothing environment-scoped", async () => {
    const bare = await setupFixture({});
    expect(can(bare.developer, "flag.read", bare.environments.dev?.id)).toBe(false);
    expect(can(bare.developer, "flag.set_value", bare.environments.dev?.id)).toBe(false);
    expect(can(bare.developer, "audit.read")).toBe(true);
  });
});
