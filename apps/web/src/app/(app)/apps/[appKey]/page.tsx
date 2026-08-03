import type { ApplicationSummary, EnvironmentSummary, FlagListItem, Paginated } from "@cerebro/contracts";
import Link from "next/link";
import { FlagFilters } from "@/components/flag-filters";
import { Rail, RailHeader, type RailStop } from "@/components/rail";
import { api } from "@/lib/api-client";

/** The flag matrix (spec §10): one row per flag, one column per environment. */

interface SearchParams {
  q?: string;
  type?: string;
  archived?: string;
}

function buildQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.type) query.set("type", params.type);
  if (params.archived === "true") query.set("archived", "true");
  const string = query.toString();
  return string ? `?${string}` : "";
}

export default async function FlagMatrixPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ appKey: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { appKey } = await routeParams;
  const params = await searchParams;
  const showingArchived = params.archived === "true";

  const [environments, flags, applications] = await Promise.all([
    api<{ items: EnvironmentSummary[] }>("/v1/mgmt/environments"),
    api<Paginated<FlagListItem>>(
      `/v1/mgmt/applications/${appKey}/flags${buildQuery(params)}`,
    ),
    api<{ items: ApplicationSummary[] }>("/v1/mgmt/applications"),
  ]);

  const ordered = [...environments.items].sort((a, b) => a.rank - b.rank);
  const application = applications.items.find((a) => a.key === appKey);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title">{application?.name ?? appKey}</h1>
          <p className="hud mt-2 text-[12px]" style={{ color: "var(--ink-dim)" }}>
            {String(flags.items.length).padStart(2, "0")}{" "}
            {showingArchived ? "ARCHIVED" : "ACTIVE"} · {ordered.length} ENV
          </p>
        </div>
        <Link className="btn btn-primary" href={`/apps/${appKey}/flags/new`}>
          New flag
        </Link>
      </div>

      <FlagFilters q={params.q ?? ""} type={params.type ?? ""} archived={showingArchived} />

      <section className="panel panel-ticks mt-5" aria-label="Flags by environment">
        <div className="grid gap-6 px-6 pt-5 pb-1 md:grid-cols-[minmax(200px,1fr)_minmax(280px,440px)]">
          <span className="eyebrow self-end pb-2">Flag</span>
          <div className="hidden md:block">
            <RailHeader environmentKeys={ordered.map((e) => e.key)} />
          </div>
        </div>

        {flags.items.length === 0 ? (
          <p className="prose px-6 py-14 text-center text-sm" style={{ color: "var(--ink-dim)" }}>
            {params.q || params.type
              ? "No flags match those filters."
              : showingArchived
                ? "Nothing archived."
                : `No flags yet. Create one in ${ordered[0]?.key ?? "the first environment"} — every flag starts there and moves up.`}
          </p>
        ) : (
          <div className="stripe">
            {flags.items.map((flag, row) => {
              const byKey = new Map(flag.environments.map((cell) => [cell.key, cell]));
              const stops: RailStop[] = ordered.map((env) => {
                const cell = byKey.get(env.key);
                return {
                  environmentKey: env.key,
                  rank: env.rank,
                  promoted: cell?.state === "promoted" && !flag.archivedAt,
                  enabled: (cell?.enabled ?? false) && !flag.archivedAt,
                  value: cell?.value,
                };
              });

              const liveSomewhere = stops.some((stop) => stop.enabled);

              return (
                <div
                  key={flag.key}
                  className="grid items-center gap-6 px-6 py-4 md:grid-cols-[minmax(200px,1fr)_minmax(280px,440px)]"
                >
                  <div className={liveSomewhere ? "marker" : "pl-[14px]"}>
                    <Link href={`/apps/${appKey}/flags/${flag.key}`} className="inline-flex flex-wrap items-center gap-2.5">
                      <span
                        className="flag-key"
                        style={
                          flag.archivedAt
                            ? { opacity: 0.45, textDecoration: "line-through" }
                            : undefined
                        }
                      >
                        {flag.key}
                      </span>
                      <span className="badge">{flag.type}</span>
                      {flag.isClientSafe && <span className="badge badge-safe">client</span>}
                    </Link>
                    <div className="flag-name mt-1.5">
                      {flag.archivedAt ? `${flag.name} — archived` : flag.name}
                    </div>
                  </div>
                  <Rail stops={stops} type={flag.type} row={row} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
