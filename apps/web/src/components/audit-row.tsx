"use client";

import type { AuditEntry } from "@cerebro/contracts";
import { useState } from "react";
import { envColor } from "@/lib/env-color";

/** One audit entry, expandable to the before/after it recorded. */
export function AuditRow({
  entry,
  environments,
}: {
  entry: AuditEntry;
  environments: string[];
}) {
  const [open, setOpen] = useState(false);
  const hasDiff = entry.before !== null || entry.after !== null;

  const rank = entry.environmentKey ? environments.indexOf(entry.environmentKey) : -1;
  const color = rank >= 0 ? envColor(rank, environments.length) : "var(--ink-dim)";

  return (
    <div>
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        disabled={!hasDiff}
        style={{ cursor: hasDiff ? "pointer" : "default" }}
      >
        <span className="hud text-[14px]" style={{ minWidth: "20ch", color: "var(--ink)" }}>
          {entry.action}
        </span>

        {entry.environmentKey && (
          <span className="badge" style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}>
            {entry.environmentKey}
          </span>
        )}

        <span className="text-[14px]" style={{ color: "var(--ink-dim)" }}>
          {entry.actor?.name ?? "system"}
        </span>

        <span className="ml-auto text-xs" style={{ color: "var(--ink-dim)" }}>
          {new Date(entry.createdAt).toLocaleString()}
        </span>

        {hasDiff && (
          <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
            {open ? "−" : "+"}
          </span>
        )}
      </button>

      {open && (
        <div className="grid gap-4 px-5 pb-4 md:grid-cols-2">
          <Side label="Before" value={entry.before} />
          <Side label="After" value={entry.after} />
        </div>
      )}
    </div>
  );
}

function Side({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <pre
        className="hud mt-2 overflow-x-auto p-3 text-xs"
        style={{ background: "var(--void)" }}
      >
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
