import type { FlagDetail, Me } from "@cerebro/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnvironmentCard } from "@/components/environment-card";
import { FlagMetadata } from "@/components/flag-metadata";
import { Rail, type RailStop } from "@/components/rail";
import { api, ApiError } from "@/lib/api-client";

export default async function FlagDetailPage({
  params,
}: {
  params: Promise<{ appKey: string; key: string }>;
}) {
  const { appKey, key } = await params;

  let flag: FlagDetail;
  try {
    flag = await api<FlagDetail>(`/v1/mgmt/applications/${appKey}/flags/${key}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const me = await api<Me>("/v1/auth/me");

  const environments = [...flag.environments].sort((a, b) => a.rank - b.rank);
  const isArchived = flag.archivedAt !== null;
  const stops: RailStop[] = environments.map((env) => ({
    environmentKey: env.key,
    rank: env.rank,
    promoted: env.state === "promoted" && !isArchived,
    enabled: env.enabled && !isArchived,
    value: env.value,
  }));

  return (
    <>
      <Link href={`/apps/${appKey}`} className="eyebrow" style={{ color: "var(--ink-dim)" }}>
        ← {appKey}
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="hud text-[28px] font-medium" style={{ color: "var(--signal)" }}>
            {flag.key}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="badge">{flag.type}</span>
            {flag.isClientSafe && <span className="badge badge-safe">client-safe</span>}
            {isArchived && <span className="badge">archived</span>}
            <span className="text-[15px]" style={{ color: "var(--ink-dim)" }}>
              {flag.name}
            </span>
          </div>
          {flag.description && (
            <p className="prose mt-3 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
              {flag.description}
            </p>
          )}
          <p className="mt-3 text-xs" style={{ color: "var(--ink-dim)" }}>
            Default when off: <code className="hud">{JSON.stringify(flag.defaultValue)}</code> ·
            created by {flag.createdBy?.name ?? "unknown"}
          </p>
        </div>

        <div className="w-full max-w-sm">
          <Rail stops={stops} type={flag.type} showLabels />
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          {environments.map((env, index) => (
            <EnvironmentCard
              key={env.key}
              appKey={appKey}
              flagKey={flag.key}
              type={flag.type}
              env={env}
              rank={env.rank}
              total={environments.length}
              previousEnvKey={index === 0 ? null : (environments[index - 1]?.key ?? null)}
              previousPromoted={index === 0 || environments[index - 1]?.state === "promoted"}
              isAdmin={me.role === "admin"}
              isArchived={isArchived}
            />
          ))}

          <FlagMetadata
            appKey={appKey}
            flagKey={flag.key}
            name={flag.name}
            description={flag.description}
            isClientSafe={flag.isClientSafe}
            isArchived={isArchived}
          />
        </div>

        <aside className="flex flex-col gap-6">
          <section className="panel p-5">
            <h2 className="eyebrow">Promotion history</h2>
            <ol className="mt-4 flex flex-col gap-3">
              {flag.promotions.map((promotion, index) => (
                <li key={index} className="text-[13px]">
                  <span className="hud">
                    {promotion.fromEnv ? `${promotion.fromEnv} → ${promotion.toEnv}` : `created in ${promotion.toEnv}`}
                  </span>
                  <div style={{ color: "var(--ink-dim)" }}>
                    {promotion.actor ?? "unknown"} ·{" "}
                    {new Date(promotion.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel p-5">
            <h2 className="eyebrow">Recent activity</h2>
            <ol className="mt-4 flex flex-col gap-3">
              {flag.recentAudit.length === 0 && (
                <li className="text-[13px]" style={{ color: "var(--ink-dim)" }}>
                  Nothing yet.
                </li>
              )}
              {flag.recentAudit.map((entry) => (
                <li key={entry.id} className="text-[13px]">
                  <span className="hud">{entry.action}</span>
                  {entry.environmentKey && (
                    <span style={{ color: "var(--ink-dim)" }}> in {entry.environmentKey}</span>
                  )}
                  <div style={{ color: "var(--ink-dim)" }}>
                    {entry.actor ?? "system"} · {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ol>
            <Link
              href={`/audit?application=${appKey}`}
              className="mt-4 inline-block text-[13px]"
              style={{ color: "var(--ink-dim)" }}
            >
              Full audit log →
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
