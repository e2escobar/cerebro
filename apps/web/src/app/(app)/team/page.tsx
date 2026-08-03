import type { EnvironmentSummary, PermissionGrant, UserRecord } from "@cerebro/contracts";
import { TeamManager } from "@/components/team-manager";
import { api } from "@/lib/api-client";
import { NotAdmin, requireAdmin } from "@/lib/require-admin";

export default async function TeamPage() {
  if (!(await requireAdmin())) return <NotAdmin what="People and permissions" />;

  const [environments, users] = await Promise.all([
    api<{ items: EnvironmentSummary[] }>("/v1/mgmt/environments"),
    api<{ items: UserRecord[] }>("/v1/mgmt/users"),
  ]);

  const ordered = [...environments.items].sort((a, b) => a.rank - b.rank);

  const grants = await Promise.all(
    users.items.map(async (user) => ({
      userId: user.id,
      grants: (await api<{ grants: PermissionGrant[] }>(`/v1/mgmt/users/${user.id}/permissions`))
        .grants,
    })),
  );

  return (
    <>
      <h1 className="title">Team</h1>
      <p className="prose mt-2 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
        Admins can do everything everywhere. Developers can do only what they are granted, per
        environment.
      </p>

      <TeamManager
        environments={ordered}
        users={users.items}
        grants={Object.fromEntries(grants.map((entry) => [entry.userId, entry.grants]))}
      />
    </>
  );
}
