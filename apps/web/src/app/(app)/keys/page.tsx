import type { ApiKeySummary, ApplicationSummary, EnvironmentSummary } from "@cerebro/contracts";
import { KeyManager } from "@/components/key-manager";
import { api } from "@/lib/api-client";
import { NotAdmin, requireAdmin } from "@/lib/require-admin";

export default async function KeysPage() {
  if (!(await requireAdmin())) return <NotAdmin what="SDK keys" />;

  const [environments, keys, applications] = await Promise.all([
    api<{ items: EnvironmentSummary[] }>("/v1/mgmt/environments"),
    api<{ items: ApiKeySummary[] }>("/v1/mgmt/api-keys"),
    api<{ items: ApplicationSummary[] }>("/v1/mgmt/applications"),
  ]);

  const ordered = [...environments.items].sort((a, b) => a.rank - b.rank);

  return (
    <>
      <h1 className="title">API keys</h1>
      <p className="prose mt-2 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
        Each key belongs to one environment — that is how the SDK knows which flags to serve. A key
        is shown once, when you create it, and never again.
      </p>

      <KeyManager applications={applications.items} environments={ordered} keys={keys.items} />
    </>
  );
}
