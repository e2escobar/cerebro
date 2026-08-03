import type { ApplicationSummary } from "@cerebro/contracts";
import { ApplicationManager } from "@/components/application-manager";
import { api } from "@/lib/api-client";
import { NotAdmin, requireAdmin } from "@/lib/require-admin";

export default async function ApplicationsPage() {
  if (!(await requireAdmin())) return <NotAdmin what="Applications" />;

  const { items } = await api<{ items: ApplicationSummary[] }>("/v1/mgmt/applications");

  return (
    <>
      <h1 className="title">Applications</h1>
      <p className="prose mt-2 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
        Every flag belongs to exactly one application, and the same key means different things in
        different ones. An application has to exist before anyone can create a flag in it.
      </p>

      <ApplicationManager applications={items} />
    </>
  );
}
