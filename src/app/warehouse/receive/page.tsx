import { getServerSession } from "next-auth";
import BatchReceiveForm from "@/components/BatchReceiveForm";
import BatchImportForm from "@/components/BatchImportForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { authOptions } from "@/lib/auth";
import { farmLabel, flowerTypesForFarm } from "@/lib/constants";

import SectionTabs from "@/components/SectionTabs";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const varieties = await listVarietiesByType();
  // Зав. складом принимает только цветок своего производства.
  const allowedTypes = flowerTypesForFarm(farm);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">
          Приёмка с производства{farm ? ` · ${farmLabel(farm)}` : ""}
        </h1>
        <p className="text-ink-secondary">
          Загрузите файл со списком партий за день или добавьте партию вручную. Дата сбора важна —
          по ней считается срок хранения.
        </p>
      </div>

      <SectionTabs tabs={WAREHOUSE_TABS} />

      <BatchImportForm />

      <div>
        <h2 className="font-medium mb-2">Добавить одну партию вручную</h2>
        <BatchReceiveForm varieties={varieties} allowedTypes={allowedTypes} />
      </div>
    </div>
  );
}
