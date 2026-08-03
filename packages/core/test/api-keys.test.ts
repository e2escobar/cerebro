import { beforeEach, describe, expect, test } from "bun:test";
import {
  KEY_PREFIX_LENGTH,
  createApiKey,
  generateKey,
  hashKey,
  resolveKey,
  revokeApiKey,
} from "../src/api-keys.ts";
import type { DomainError } from "../src/errors.ts";
import { db, setupFixture, type Fixture } from "./helpers.ts";

/** Spec §8. */

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setupFixture();
});

describe("SDK keys", () => {
  test("are formatted cbr_<appKey>_<envKey>_<32 url-safe chars>", () => {
    const key = generateKey("checkout", "prod");
    expect(key).toMatch(/^cbr_checkout_prod_[A-Za-z0-9_-]{32}$/);
    expect(generateKey("checkout", "prod")).not.toBe(key);
  });

  test("store only a hash and a displayable prefix", async () => {
    const { record, rawKey } = await createApiKey(
      { db, actor: fixture.admin },
      { applicationKey: "checkout", environmentKey: "prod", name: "Prod server", kind: "server" },
    );

    expect(record.keyHash).toBe(hashKey(rawKey));
    expect(record.keyHash).not.toContain(rawKey);
    expect(record.prefix).toBe(rawKey.slice(0, KEY_PREFIX_LENGTH));
    expect(rawKey).toContain(record.prefix);
  });

  test("resolve to their environment, and stop resolving once revoked", async () => {
    const { record, rawKey } = await createApiKey(
      { db, actor: fixture.admin },
      { applicationKey: "checkout", environmentKey: "qa", name: "QA", kind: "server" },
    );

    const resolved = await resolveKey(db, rawKey);
    expect(resolved?.environment.key).toBe("qa");
    // A key resolves to a pair: the application as well as the environment.
    expect(resolved?.application.key).toBe("checkout");
    expect(resolved?.key.id).toBe(record.id);

    await revokeApiKey({ db, actor: fixture.admin }, record.id);
    expect(await resolveKey(db, rawKey)).toBeNull();
  });

  test("an unknown key resolves to null", async () => {
    expect(await resolveKey(db, "cbr_checkout_prod_totallymadeupkey00")).toBeNull();
  });

  test("creation and revocation are admin only", async () => {
    const code = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return "NO_ERROR";
      } catch (error) {
        return (error as DomainError).code;
      }
    };

    expect(
      await code(() =>
        createApiKey(
          { db, actor: fixture.developer },
          { applicationKey: "checkout", environmentKey: "dev", name: "x", kind: "server" },
        ),
      ),
    ).toBe("FORBIDDEN");

    const { record } = await createApiKey(
      { db, actor: fixture.admin },
      { applicationKey: "checkout", environmentKey: "dev", name: "d", kind: "client" },
    );
    expect(await code(() => revokeApiKey({ db, actor: fixture.developer }, record.id))).toBe(
      "FORBIDDEN",
    );
  });
});
