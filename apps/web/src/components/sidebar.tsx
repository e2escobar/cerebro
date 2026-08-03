"use client";

import type { ApplicationSummary, Me } from "@cerebro/contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The console rail. It replaces the header so the full width of the page
 * belongs to the matrix, and collapses to two-letter codes when it is in the
 * way. The collapsed state is remembered per browser.
 */

interface Destination {
  href: string;
  label: string;
  /** Shown alone when collapsed — the whole label at 60px wide. */
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

const STORAGE_KEY = "cerebro:sidebar-collapsed";

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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  const destinations = DESTINATIONS.filter((d) => !d.adminOnly || me.role === "admin");

  return (
    <aside className={`sidebar panel-ticks ${collapsed ? "sidebar-collapsed" : ""}`}>
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <button
          type="button"
          onClick={toggle}
          className="flex h-8 w-9 flex-none items-center justify-center text-[14px]"
          style={{ background: "var(--surface-3)", color: "var(--signal)" }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? "»" : "«"}
        </button>
        <Link
          href="/"
          className="wordmark sidebar-label text-[15px]"
          style={{ color: "var(--signal)" }}
        >
          Cerebro
        </Link>
      </div>

      <div style={{ height: "2px", background: "var(--signal)", opacity: 0.85 }} />

      {/* The application you are working in — flags only exist inside one. */}
      <nav className="sidebar-nav mt-2">
        <span className="eyebrow sidebar-label px-2.5 pt-1 pb-1.5">Application</span>
        {applications.map((app) => {
          const active = currentApp === app.key;
          return (
            <Link
              key={app.key}
              href={`/apps/${app.key}`}
              className="sidebar-link"
              aria-current={active ? "page" : undefined}
              title={collapsed ? app.name : undefined}
            >
              <span className="sidebar-code">{app.key.slice(0, 2).toUpperCase()}</span>
              <span className="sidebar-label">{app.name}</span>
            </Link>
          );
        })}
        {applications.length === 0 && (
          <span className="sidebar-label px-2.5 py-2 text-[13px]" style={{ color: "var(--ink-dim)" }}>
            None yet
          </span>
        )}

        <span className="eyebrow sidebar-label px-2.5 pt-4 pb-1.5">Manage</span>
        {destinations.map((destination) => {
          const active = pathname.startsWith(destination.href);

          return (
            <Link
              key={destination.href}
              href={destination.href}
              className="sidebar-link"
              aria-current={active ? "page" : undefined}
              title={collapsed ? destination.label : undefined}
            >
              <span className="sidebar-code">{destination.code}</span>
              <span className="sidebar-label">{destination.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-3 pb-4">
        <div className="sidebar-label mb-2">
          <div className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>
            {me.name}
          </div>
          <div className="eyebrow mt-1">
            {me.role.toUpperCase()}
          </div>
        </div>

        <form action={signOut}>
          <button
            className="btn w-full"
            type="submit"
            title={collapsed ? "Sign out" : undefined}
            style={collapsed ? { padding: "10px 0" } : undefined}
          >
            {collapsed ? "⏻" : "Sign out"}
          </button>
        </form>
      </div>
    </aside>
  );
}
