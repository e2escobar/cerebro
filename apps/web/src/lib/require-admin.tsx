import type { Me } from "@cerebro/contracts";
import { api } from "./api-client";

/**
 * Admin pages are reachable by URL, so each one asks the API who it is talking
 * to. The API is still the authority — this only avoids offering controls that
 * would be refused.
 */
export async function requireAdmin(): Promise<Me | null> {
  const me = await api<Me>("/v1/auth/me");
  return me.role === "admin" ? me : null;
}

export function NotAdmin({ what }: { what: string }) {
  return (
    <div className="panel mt-8 p-6">
      <h1 className="text-base font-semibold">Admins only</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-dim)" }}>
        {what} is managed by an admin. Ask one of them if you need a change here.
      </p>
    </div>
  );
}
