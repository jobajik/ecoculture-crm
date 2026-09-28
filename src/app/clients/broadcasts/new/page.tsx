import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { loadAudience } from "@/lib/broadcastAudience";
import { listUsers } from "@/lib/repo/users";
import PageHeader from "@/components/PageHeader";
import BroadcastComposer from "@/components/BroadcastComposer";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function distinct(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "ru"));
}

export default async function NewBroadcastPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) redirect("/clients");

  const [audience, users] = await Promise.all([loadAudience({ withOrders: true }), listUsers()]);
  const rows = audience.map((a) => ({
    kind: a.kind,
    refId: a.refId,
    name: a.name,
    contactPerson: a.contactPerson,
    city: a.city,
    managerEmail: a.managerEmail.toLowerCase(),
    clientType: a.clientType,
    stage: a.stage,
    campaign: a.campaign,
    segment: a.segment,
    daysSinceOrder: a.daysSinceOrder,
    waPhone: a.waPhone,
    excluded: a.excluded,
  }));
  const managers = users
    .filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD || u.role === ROLES.ADMIN))
    .map((u) => ({ email: u.email.toLowerCase(), name: u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    <div className="space-y-6">
      <PageHeader area="leads" title="Новая рассылка" tabs={clientsTabsFor(undefined, role)} />
      <BroadcastComposer
        rows={rows}
        managers={managers}
        names={Object.fromEntries(users.map((u) => [u.email.toLowerCase(), u.name || u.email]))}
        cities={distinct(rows.map((r) => r.city))}
        campaigns={distinct(rows.filter((r) => r.kind === "lead").map((r) => r.campaign))}
        segments={distinct(rows.filter((r) => r.kind === "lead").map((r) => r.segment))}
        clientTypes={distinct(rows.map((r) => r.clientType))}
      />
    </div>
  );
}
