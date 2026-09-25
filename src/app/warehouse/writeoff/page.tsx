import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { farmLabel } from "@/lib/constants";
import { stockPositions } from "@/lib/writeoffPlan";
import PageHeader from "@/components/PageHeader";
import WriteoffBulkForm from "@/components/WriteoffBulkForm";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * Списание общим количеством: позиция и сколько — без партии и даты.
 * Раскладку по партиям (от старых к свежим) делает сервер — `writeoffPlan.ts`.
 * Списание одной конкретной партии осталось там же, где было, — в «Партиях».
 */
export default async function WriteoffPage({ searchParams }: { searchParams?: { mode?: string } }) {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;
  const positions = stockPositions(await listBatches(), farm);

  return (
    <div className="max-w-4xl">
      <PageHeader
        area="stock"
        title={`Списание${farm ? ` · ${farmLabel(farm)}` : ""}`}
        subtitle="Снимается с самых старых партий позиции."
        icon="alert"
        tabs={WAREHOUSE_TABS}
      />
      <WriteoffBulkForm positions={positions} initialMode={searchParams?.mode === "recount" ? "recount" : "writeoff"} />
    </div>
  );
}
