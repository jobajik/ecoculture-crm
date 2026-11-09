import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { farmLabel } from "@/lib/constants";
import { stockPositions } from "@/lib/writeoffPlan";
import { inStore } from "@/lib/officeStore";
import PageHeader from "@/components/PageHeader";
import StockMoveForm from "@/components/StockMoveForm";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * «В офис» (09.11.2026): зав. складом отдаёт цветок своего производства на подсклад «Офис» — Разия в субботу отправила
 * в офис хризантему и эустому для продажи по городу, а записать это в CRM было негде (перемещал только РОП, `/office`).
 * Та же форма, что у РОПа, но только «Склад → Офис» и только свои позиции; обратно возвращает РОП (`moveRefusal`).
 */
export default async function ToOfficePage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;
  const batches = await listBatches();
  const main = stockPositions(inStore(batches, ""), farm);
  return (
    <div>
      <PageHeader
        area="stock"
        title={`В офис${farm ? ` · ${farmLabel(farm)}` : ""}`}
        subtitle="Отдать цветок на подсклад «Офис» для продажи по городу. Снимается с самых старых партий; обратно возвращает РОП."
        icon="box"
        tabs={WAREHOUSE_TABS}
      />
      <div className="card !p-0 overflow-hidden">
        <StockMoveForm main={main} office={[]} onlyToOffice />
      </div>
    </div>
  );
}
