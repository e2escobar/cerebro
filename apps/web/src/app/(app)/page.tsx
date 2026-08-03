import type { ApplicationSummary } from "@cerebro/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api-client";

/**
 * There is no such thing as "all flags" any more — flags live in an
 * application. Go straight to the only one if there is only one, otherwise
 * ask which.
 */
export default async function RootPage() {
  const { items } = await api<{ items: ApplicationSummary[] }>("/v1/mgmt/applications");

  if (items.length === 1 && items[0]) redirect(`/apps/${items[0].key}`);

  return (
    <>
      <h1 className="title">Applications</h1>
      <p className="prose mt-2 max-w-prose text-sm" style={{ color: "var(--ink-dim)" }}>
        Every flag belongs to one application. The same key can mean different things in different
        applications — they never see each other&rsquo;s flags.
      </p>

      {items.length === 0 ? (
        <p className="panel prose mt-6 p-8 text-center text-sm" style={{ color: "var(--ink-dim)" }}>
          No applications yet. An admin creates the first one under Applications.
        </p>
      ) : (
        <div className="stripe panel panel-ticks mt-6">
          {items.map((app) => (
            <Link
              key={app.key}
              href={`/apps/${app.key}`}
              className="flex flex-wrap items-center gap-4 px-6 py-5"
            >
              <span className="hud text-[15px]" style={{ color: "var(--signal)" }}>
                {app.key}
              </span>
              <span className="text-[15px]">{app.name}</span>
              <span className="badge ml-auto">
                {app.flagCount} flag{app.flagCount === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
