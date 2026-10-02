import { listBatches } from "@/lib/repo/batches";
import { stockPositions } from "@/lib/writeoffPlan";
import { inStore } from "@/lib/officeStore";
import PageHeader from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import WriteoffBulkForm from "@/components/WriteoffBulkForm";
import { officeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/** Списание в офисе — тем же путём, что на основном складе, но только офисные партии. */
export default async function OfficeWriteoffPage({ searchParams }: { searchParams?: { mode?: string } }) {
  const role = (await getServerSession(authOptions))?.user?.role ?? "";
  const positions = stockPositions(inStore(await listBatches(), "office"), null);
  return (
    <div className="max-w-4xl">
      <PageHeader area="stock" title="Списание в офисе" subtitle="Снимается с самых старых партий позиции." icon="alert" tabs={officeTabsFor(role)} />
      {role === "sales_head" ? (
        <p className="card text-sm text-ink-secondary">Списывает склад офиса.</p>
      ) : (
      <WriteoffBulkForm positions={positions} store="office" initialMode={searchParams?.mode === "recount" ? "recount" : "writeoff"} />
      )}
    </div>
  );
}
