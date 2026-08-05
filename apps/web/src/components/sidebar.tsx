"use client";

import type { ApplicationSummary, Me } from "@cerebro/contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The console rail. It replaces the header so the full width of the page
 * belongs to the matrix.
 */

interface Destination {
  href: string;
  label: string;
  /** The two-letter code that stands in front of the label. */
  code: string;
  adminOnly?: boolean;
}

const DESTINATIONS: Destination[] = [
  { href: "/audit", label: "Audit", code: "AU" },
  { href: "/applications", label: "Apps", code: "AP", adminOnly: true },
  { href: "/environments", label: "Pipeline", code: "PI", adminOnly: true },
  { href: "/keys", label: "Keys", code: "KE", adminOnly: true },
  { href: "/team", label: "Team", code: "TE", adminOnly: true },
];

export function Sidebar({
  me,
  applications,
  signOut,
}: {
  me: Me;
  applications: ApplicationSummary[];
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const currentApp = /^\/apps\/([^/]+)/.exec(pathname)?.[1];

  const destinations = DESTINATIONS.filter((d) => !d.adminOnly || me.role === "admin");

  return (
    <aside className="sidebar panel-ticks">
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <Link href="/" className="wordmark text-[15px]" style={{ color: "var(--signal)" }}>
          Cerebro
        </Link>
      </div>

      <div style={{ height: "2px", background: "var(--signal)", opacity: 0.85 }} />

      {/* The application you are working in — flags only exist inside one. */}
      <nav className="sidebar-nav mt-2">
        <span className="eyebrow px-2.5 pt-1 pb-1.5">Application</span>
        {applications.map((app) => {
          const active = currentApp === app.key;
          return (
            <Link
              key={app.key}
              href={`/apps/${app.key}`}
              className="sidebar-link"
              aria-current={active ? "page" : undefined}
            >
              <span className="sidebar-code">{app.key.slice(0, 2).toUpperCase()}</span>
              <span>{app.name}</span>
            </Link>
          );
        })}
        {applications.length === 0 && (
          <span className="px-2.5 py-2 text-[13px]" style={{ color: "var(--ink-dim)" }}>
            None yet
          </span>
        )}

        <span className="eyebrow px-2.5 pt-4 pb-1.5">Manage</span>
        {destinations.map((destination) => {
          const active = pathname.startsWith(destination.href);

          return (
            <Link
              key={destination.href}
              href={destination.href}
              className="sidebar-link"
              aria-current={active ? "page" : undefined}
            >
              <span className="sidebar-code">{destination.code}</span>
              <span>{destination.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-3 pb-4">
        <div className="mb-2">
          <div className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>
            {me.name}
          </div>
          <div className="eyebrow mt-1">
            {me.role.toUpperCase()}
          </div>
        </div>

        <form action={signOut}>
          <button className="btn w-full" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
