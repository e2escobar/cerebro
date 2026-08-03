import type { AuditEntry, EnvironmentSummary, Paginated } from "@cerebro/contracts";
import Link from "next/link";
import { AuditRow } from "@/components/audit-row";
import { api } from "@/lib/api-client";

interface SearchParams {
  entityType?: string;
  environmentKey?: string;
  cursor?: string;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const query = new URLSearchParams({ limit: "50" });
  if (params.entityType) query.set("entityType", params.entityType);
  if (params.environmentKey) query.set("environmentKey", params.environmentKey);
  if (params.cursor) query.set("cursor", params.cursor);

  const [environments, audit] = await Promise.all([
    api<{ items: EnvironmentSummary[] }>("/v1/mgmt/environments"),
    api<Paginated<AuditEntry>>(`/v1/mgmt/audit?${query.toString()}`),
  ]);

  const ordered = [...environments.items].sort((a, b) => a.rank - b.rank);

  return (
    <>
      <h1 className="title">Audit</h1>
      <p className="prose mt-2 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
        Every change, in order. Expand a row to see exactly what moved.
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-2.5">
        <select
          className="field w-auto"
          name="entityType"
          defaultValue={params.entityType ?? ""}
          aria-label="Kind"
        >
          <option value="">Everything</option>
          <option value="flag">Flags</option>
          <option value="environment">Environments</option>
          <option value="api_key">API keys</option>
          <option value="user">People</option>
          <option value="permission">Permissions</option>
        </select>

        <select
          className="field w-auto"
          name="environmentKey"
          defaultValue={params.environmentKey ?? ""}
          aria-label="Environment"
        >
          <option value="">Any environment</option>
          {ordered.map((env) => (
            <option key={env.key} value={env.key}>
              {env.key}
            </option>
          ))}
        </select>

        <button className="btn" type="submit">
          Apply
        </button>
      </form>

      <section className="panel panel-ticks mt-6">
        {audit.items.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm" style={{ color: "var(--ink-dim)" }}>
            Nothing recorded yet.
          </p>
        ) : (
          <div className="stripe">
            {audit.items.map((entry) => (
              <AuditRow key={entry.id} entry={entry} environments={ordered.map((e) => e.key)} />
            ))}
          </div>
        )}
      </section>

      {audit.nextCursor && (
        <Link
          className="btn mt-4 inline-block"
          href={{
            pathname: "/audit",
            query: { ...params, cursor: audit.nextCursor },
          }}
        >
          Older entries
        </Link>
      )}
    </>
  );
}
