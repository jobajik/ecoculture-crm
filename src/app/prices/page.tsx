import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCurrentPrices, listPrices } from "@/lib/repo/prices";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { FLOWER_TYPES, ROLES } from "@/lib/constants";
import { priceMapForClient } from "@/lib/priceList";
import { priceChangeDays, daysSinceLastChange } from "@/lib/priceChanges";
import PriceBoard from "@/components/PriceBoard";
import PriceImportForm from "@/components/PriceImportForm";
import PriceChangesView from "@/components/PriceChangesView";
import SectionTabs from "@/components/SectionTabs";
import { plansTabsFor } from "../plans/tabs";
import { salesTabsFor } from "../sales/tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FLOWER_ORDER = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

/** После скольких дней без правок прайс считаем залежавшимся. */
const STALE_DAYS = 30;

export default async function PricesPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Смотреть прайс полезно и менеджеру — он по нему продаёт. Заносить цену
  // может только РОП и администратор: это решение о деньгах, и владелец прямо
  // отнёс его к зоне ответственности руководителя отдела продаж.
  if (!role || ![ROLES.SALES_HEAD, ROLES.ADMIN, ROLES.MANAGER].includes(role as never)) {
    redirect("/");
  }
  const canEdit = role === ROLES.SALES_HEAD || role === ROLES.ADMIN;

  const [varieties, prices, all] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(),
    listPrices(),
  ]);

  const changeDays = priceChangeDays(all);
  const today = new Date().toISOString().slice(0, 10);
  const sinceChange = daysSinceLastChange(changeDays, today);
  const filled = Array.from(prices.values()).filter((r) => r.price > 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Прайс-лист</h1>
        <p className="text-sm text-ink-secondary">
          {canEdit
            ? "Цену задаёт руководитель отдела продаж — файлом или прямо в таблице ниже. Менеджер по этой цене продаёт и может поправить цифру в заявке вручную, но отклонение от прайса видно в аналитике."
            : "Цена за стебель, её задаёт руководитель отдела продаж. В заявке цена подставляется сама; если договорились на другую, её можно поправить вручную — отклонение от прайса видно в аналитике."}
        </p>
      </div>

      {/* Прайс живёт в разделе «Планы» у РОПа и в «Продажах» у менеджера:
          у одного это инструмент планирования, у другого — справка. */}
      <SectionTabs tabs={canEdit ? plansTabsFor(role) : salesTabsFor(role)} />

      <p className="text-sm text-ink-muted">
        {filled > 0 ? `Заполнено цен: ${filled}` : "Прайс пока пуст"}
        {changeDays.length > 0 &&
          ` · последнее изменение ${new Date(
            `${changeDays[0].date}T00:00:00`
          ).toLocaleDateString("ru-RU")}`}
        {sinceChange !== null &&
          (sinceChange === 0
            ? " (сегодня)"
            : sinceChange > STALE_DAYS
            ? ` — ${sinceChange} дн. назад, пора пересмотреть`
            : ` — ${sinceChange} дн. назад`)}
        {!canEdit && " · у вас доступ только на просмотр"}
      </p>

      {canEdit && <PriceImportForm />}

      <PriceBoard
        flowerTypes={FLOWER_ORDER as unknown as string[]}
        varieties={varieties}
        initial={priceMapForClient(prices)}
        canEdit={canEdit}
      />

      <PriceChangesView days={changeDays} />
    </div>
  );
}
