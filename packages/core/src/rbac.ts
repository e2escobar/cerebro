import { appUser, envPermission, type EnvPermissionKind, type Tx, type UserRole } from "@cerebro/db";
import { eq } from "drizzle-orm";
import { Forbidden, NotFound } from "./errors.ts";

/**
 * Authorization (spec §5.6). Every permission decision in the system goes
 * through `can()` — route handlers contain no permission logic beyond calling it.
 */

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** environmentId → granted permissions. Empty for admins, who bypass grants. */
  permissions: ReadonlyMap<string, ReadonlySet<EnvPermissionKind>>;
}

export type Action =
  | "application.manage"
  | "environment.create"
  | "environment.update"
  | "environment.reorder"
  | "environment.delete"
  | "api_key.create"
  | "api_key.revoke"
  | "user.manage"
  | "permission.manage"
  | "flag.create"
  | "flag.update_metadata"
  | "flag.rename"
  | "flag.archive"
  | "flag.restore"
  | "flag.set_value"
  | "flag.toggle"
  | "flag.promote"
  | "flag.demote"
  | "flag.read"
  | "audit.read";

type Requirement =
  | { kind: "admin" }
  | { kind: "authenticated" }
  /** Needs `permission` on the environment passed to `can()`. */
  | { kind: "environment"; permission: EnvPermissionKind }
  /** Needs `permission` on the rank-0 environment, which the caller supplies. */
  | { kind: "base-environment"; permission: EnvPermissionKind };

const REQUIREMENTS: Record<Action, Requirement> = {
  "application.manage": { kind: "admin" },
  "environment.create": { kind: "admin" },
  "environment.update": { kind: "admin" },
  "environment.reorder": { kind: "admin" },
  "environment.delete": { kind: "admin" },
  "api_key.create": { kind: "admin" },
  "api_key.revoke": { kind: "admin" },
  "user.manage": { kind: "admin" },
  "permission.manage": { kind: "admin" },
  "flag.create": { kind: "base-environment", permission: "write" },
  "flag.update_metadata": { kind: "base-environment", permission: "write" },
  // The additional "not promoted above rank 0" condition is a domain rule,
  // enforced in flags.ts — it depends on flag state, not on the actor. It
  // applies to renaming for the same reason it applies to archiving: both take
  // the flag out of a payload someone is already reading.
  "flag.rename": { kind: "base-environment", permission: "write" },
  "flag.archive": { kind: "base-environment", permission: "write" },
  "flag.restore": { kind: "base-environment", permission: "write" },
  "flag.set_value": { kind: "environment", permission: "write" },
  "flag.toggle": { kind: "environment", permission: "toggle" },
  "flag.promote": { kind: "environment", permission: "promote" },
  "flag.demote": { kind: "admin" },
  "flag.read": { kind: "environment", permission: "read" },
  "audit.read": { kind: "authenticated" },
};

export function can(actor: Actor, action: Action, environmentId?: string): boolean {
  if (actor.role === "admin") return true;

  const requirement = REQUIREMENTS[action];
  switch (requirement.kind) {
    case "admin":
      return false;
    case "authenticated":
      return true;
    case "environment":
    case "base-environment": {
      if (!environmentId) return false;
      return actor.permissions.get(environmentId)?.has(requirement.permission) ?? false;
    }
  }
}

/** `can()` in throwing form, for use inside domain functions. */
export function assertCan(actor: Actor, action: Action, environmentId?: string): void {
  if (!can(actor, action, environmentId)) {
    throw new Forbidden(`Missing permission for ${action}`, { action, environmentId });
  }
}

export async function loadActorPermissions(
  db: Tx,
  userId: string,
): Promise<ReadonlyMap<string, ReadonlySet<EnvPermissionKind>>> {
  const rows = await db
    .select({ environmentId: envPermission.environmentId, permission: envPermission.permission })
    .from(envPermission)
    .where(eq(envPermission.userId, userId));

  const map = new Map<string, Set<EnvPermissionKind>>();
  for (const row of rows) {
    let set = map.get(row.environmentId);
    if (!set) {
      set = new Set();
      map.set(row.environmentId, set);
    }
    set.add(row.permission);
  }
  return map;
}

/** Loads a user and their grants as an `Actor`. Throws if disabled or missing. */
export async function loadActor(db: Tx, userId: string): Promise<Actor> {
  const [user] = await db.select().from(appUser).where(eq(appUser.id, userId)).limit(1);
  if (!user) throw new NotFound("USER_NOT_FOUND", "User not found", { userId });
  if (user.disabledAt) throw new Forbidden("This account is disabled");

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: await loadActorPermissions(db, user.id),
  };
}
