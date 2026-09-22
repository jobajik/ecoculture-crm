import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { farmLabel } from "@/lib/constants";
import { stockPositions } from "@/lib/writeoffPlan";
import SectionTabs from "@/components/SectionTabs";
import WriteoffBulkForm from "@/components/WriteoffBulkForm";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * Списание общим количеством: позиция и сколько — без партии и даты.
 * Раскладку по партиям (от старых к свежим) делает сервер — `writeoffPlan.ts`.
 * Списание одной конкретной партии осталось там же, где было, — в «Партиях».
 */
export default async function WriteoffPage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;
  const positions = stockPositions(await listBatches(), farm);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold mb-1">Списание{farm ? ` · ${farmLabel(farm)}` : ""}</h1>
      <p className="text-ink-secondary mb-3">
        Впишите, сколько списать по позиции, — вручную или файлом. Партию и дату выбирать не
        нужно: количество снимется с самых старых партий этой позиции.
      </p>
      <div className="mb-4">
        <SectionTabs tabs={WAREHOUSE_TABS} />
      </div>
      <WriteoffBulkForm positions={positions} />
    </div>
  );
}
