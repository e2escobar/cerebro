"use client";

import type {
  EnvPermissionInput,
  EnvironmentSummary,
  PermissionGrant,
  UserRecord,
} from "@cerebro/contracts";
import { useState, useTransition } from "react";
import { createUser, setUserPermissions, updateUser } from "@/app/(app)/admin-actions";
import type { ActionResult } from "@/app/(app)/flags-actions";
import { ConfirmAction } from "@/components/confirm-action";
import { envColor } from "@/lib/env-color";

const PERMISSIONS: EnvPermissionInput[] = ["read", "write", "toggle", "promote"];

type GrantMap = Record<string, Record<string, Set<EnvPermissionInput>>>;

function toGrantMap(grants: Record<string, PermissionGrant[]>): GrantMap {
  const map: GrantMap = {};
  for (const [userId, list] of Object.entries(grants)) {
    map[userId] = {};
    for (const grant of list) {
      map[userId][grant.environmentKey] = new Set(grant.permissions);
    }
  }
  return map;
}

export function TeamManager({
  environments,
  users,
  grants,
}: {
  environments: EnvironmentSummary[];
  users: UserRecord[];
  grants: Record<string, PermissionGrant[]>;
}) {
  const [draft, setDraft] = useState<GrantMap>(() => toGrantMap(grants));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(userId: string, envKey: string, permission: EnvPermissionInput) {
    setDraft((current) => {
      const next: GrantMap = { ...current, [userId]: { ...(current[userId] ?? {}) } };
      const set = new Set(next[userId]?.[envKey] ?? []);
      if (set.has(permission)) set.delete(permission);
      else set.add(permission);
      // `read` is implied by anything else — granting write without read is a trap.
      if (set.size > 0) set.add("read");
      if (permission === "read" && !set.has("read")) set.clear();
      next[userId]![envKey] = set;
      return next;
    });
    setDirty((current) => new Set(current).add(userId));
  }

  function save(userId: string) {
    startTransition(async () => {
      const payload = Object.entries(draft[userId] ?? {})
        .map(([environmentKey, set]) => ({
          environmentKey,
          permissions: [...set],
        }))
        .filter((grant) => grant.permissions.length > 0);

      const result = await setUserPermissions(userId, payload);
      report(result);
      if (result.ok) {
        setDirty((current) => {
          const next = new Set(current);
          next.delete(userId);
          return next;
        });
      }
    });
  }

  function report(result: ActionResult) {
    setMessage(result.ok ? null : result.message);
  }

  return (
    <>
      <section className="panel panel-ticks mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="eyebrow px-5 py-3 text-left">Person</th>
              {environments.map((env, index) => (
                <th
                  key={env.key}
                  className="eyebrow px-4 py-3 text-center"
                  style={{ color: envColor(index, environments.length) }}
                >
                  {env.key}
                </th>
              ))}
              <th className="px-5 py-3" />
            </tr>
          </thead>

          <tbody className="stripe">
            {users.map((user) => {
              const isAdmin = user.role === "admin";

              return (
                <tr key={user.id}>
                  <td className="px-5 py-4 align-top">
                    <div className="text-[15px] font-medium">{user.name}</div>
                    <div className="hud text-[13px]" style={{ color: "var(--ink-dim)" }}>
                      {user.email}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        className="field w-auto py-1.5 text-xs"
                        value={user.role}
                        onChange={(event) =>
                          startTransition(async () =>
                            report(
                              await updateUser(user.id, {
                                role: event.target.value as "admin" | "developer",
                              }),
                            ),
                          )
                        }
                      >
                        <option value="developer">developer</option>
                        <option value="admin">admin</option>
                      </select>
                      {user.disabledAt && <span className="badge">disabled</span>}
                    </div>
                  </td>

                  {environments.map((env) => (
                    <td key={env.key} className="px-4 py-4 align-top">
                      {isAdmin ? (
                        <span
                          className="block text-center text-xs"
                          style={{ color: "var(--ink-dim)" }}
                          title="Admins bypass per-environment grants."
                        >
                          all
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {PERMISSIONS.map((permission) => (
                            <label key={permission} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={draft[user.id]?.[env.key]?.has(permission) ?? false}
                                onChange={() => toggle(user.id, env.key, permission)}
                              />
                              {permission}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                  ))}

                  <td className="px-5 py-4 align-top">
                    <div className="flex flex-col items-end gap-2">
                      {!isAdmin && (
                        <button
                          className="btn"
                          type="button"
                          disabled={!dirty.has(user.id) || pending}
                          onClick={() => save(user.id)}
                        >
                          {pending ? "Saving…" : "Save"}
                        </button>
                      )}
                      <ConfirmAction
                        label={user.disabledAt ? "Enable" : "Disable"}
                        className="btn btn-danger"
                        confirmWith={user.disabledAt ? null : user.email}
                        title={`Disable ${user.name}`}
                        description="Their sessions stop working immediately. Their audit history is kept."
                        onConfirm={() => updateUser(user.id, { disabled: !user.disabledAt })}
                        onResult={report}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {message && (
        <p role="alert" className="mt-4 text-sm" style={{ color: "var(--signal)" }}>
          {message}
        </p>
      )}

      <NewUser onResult={report} />
    </>
  );
}

function NewUser({ onResult }: { onResult: (result: ActionResult) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "developer">("developer");
  const [pending, startTransition] = useTransition();

  return (
    <section className="panel panel-ticks mt-8 p-5">
      <h2 className="eyebrow">Add someone</h2>
      <p className="mt-2 text-[13px]" style={{ color: "var(--ink-dim)" }}>
        Set a temporary password and pass it on — they can change it later.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createUser({ email, name, password, role });
            onResult(result);
            if (result.ok) {
              setEmail("");
              setName("");
              setPassword("");
            }
          });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Email</span>
          <input
            className="field w-52"
            value={email}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Name</span>
          <input
            className="field w-44"
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Temporary password</span>
          <input
            className="field w-52"
            type="password"
            value={password}
            required
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Role</span>
          <select
            className="field w-36"
            value={role}
            onChange={(event) => setRole(event.target.value as "admin" | "developer")}
          >
            <option value="developer">developer</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button className="btn btn-primary mb-0.5" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add person"}
        </button>
      </form>
    </section>
  );
}
