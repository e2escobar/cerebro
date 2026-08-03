import type { ApplicationSummary, Me } from "@cerebro/contracts";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { api, ApiError, logout } from "@/lib/api-client";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let me: Me;
  try {
    me = await api<Me>("/v1/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/login");
    throw error;
  }

  const applications = await api<{ items: ApplicationSummary[] }>("/v1/mgmt/applications").catch(
    () => ({ items: [] as ApplicationSummary[] }),
  );

  return (
    <div className="min-h-screen">
      <Sidebar me={me} applications={applications.items} signOut={signOut} />
      <main className="page-shell py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
