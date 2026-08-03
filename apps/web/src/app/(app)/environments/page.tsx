import type { EnvironmentSummary } from "@cerebro/contracts";
import { EnvironmentManager } from "@/components/environment-manager";
import { api } from "@/lib/api-client";
import { NotAdmin, requireAdmin } from "@/lib/require-admin";

export default async function EnvironmentsPage() {
  if (!(await requireAdmin())) return <NotAdmin what="The promotion pipeline" />;

  const { items } = await api<{ items: EnvironmentSummary[] }>("/v1/mgmt/environments");
  const ordered = [...items].sort((a, b) => a.rank - b.rank);

  return (
    <>
      <h1 className="title">Pipeline</h1>
      <p className="prose mt-2 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
        Order is the promotion pipeline. Flags are created in the first environment and move up one
        step at a time — reordering is refused if it would strand a flag above an environment it has
        not reached.
      </p>

      <EnvironmentManager environments={ordered} />
    </>
  );
}
