import { localDayKey } from "@/lib/timezone";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCurrentPrices, listPrices } from "@/lib/repo/prices";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { FLOWER_TYPES, ROLES } from "@/lib/constants";
import { PRICE_KINDS, cleanPriceKind, priceMapForClient } from "@/lib/priceList";
import { priceChangeDays, daysSinceLastChange } from "@/lib/priceChanges";
import PriceBoard from "@/components/PriceBoard";
import PriceImportForm from "@/components/PriceImportForm";
import PriceChangesView from "@/components/PriceChangesView";
import PageHeader from "@/components/PageHeader";
import Hint from "@/components/Hint";
import { plansTabsFor } from "../plans/tabs";
import { salesTabsFor } from "../sales/tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FLOWER_ORDER = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

/** После скольких дней без правок прайс считаем залежавшимся. */
const STALE_DAYS = 30;

export default async function PricesPage({
  searchParams,
}: {
  searchParams?: { kind?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Смотреть прайс полезно и менеджеру — он по нему продаёт. Заносить цену
  // может только РОП и администратор: это решение о деньгах, и владелец прямо
  // отнёс его к зоне ответственности руководителя отдела продаж.
  if (!role || ![ROLES.SALES_HEAD, ROLES.ADMIN, ROLES.MANAGER].includes(role as never)) {
    redirect("/");
  }
  const canEdit = role === ROLES.SALES_HEAD || role === ROLES.ADMIN;

  // Прайса два: по клиентскому продают наружу, по внутреннему цветок передаётся
  // в наши магазины. Механика у них одна, поэтому это переключатель, а не
  // вторая страница: иначе одно и то же правило подстановки цены пришлось бы
  // чинить в двух местах.
  const kind = cleanPriceKind(searchParams?.kind);

  const [varieties, prices, all] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(undefined, kind),
    listPrices(kind),
  ]);

  const changeDays = priceChangeDays(all);
  const today = localDayKey();
  const sinceChange = daysSinceLastChange(changeDays, today);
  const filled = Array.from(prices.values()).filter((r) => r.price > 0).length;

  const stale = sinceChange !== null && sinceChange > STALE_DAYS;
  const lastChange =
    changeDays.length > 0
      ? new Date(`${changeDays[0].date}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
      : "";

  return (
    <div className="space-y-5">
      {/* У РОПа прайс — вкладка раздела «Планы», и шапка того же цвета, что у
          соседних вкладок; у менеджера — справка в «Продажах». */}
      <PageHeader
        area={canEdit ? "plans" : "sales"}
        title="Прайс-лист"
        icon="tag"
        tabs={canEdit ? plansTabsFor(role) : salesTabsFor(role)}
      />

      {/* Одна строка инструментов вместо трёх блоков: какой прайс, когда
          меняли и файл. Всё остальное на странице — сами цены. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="inline-flex rounded-lg border border-line-hairline bg-surface-plane p-1" role="tablist">
          {[PRICE_KINDS.CLIENT, PRICE_KINDS.RETAIL].map((k) => (
            <Link
              key={k || "client"}
              href={k ? `/prices?kind=${k}` : "/prices"}
              role="tab"
              aria-selected={k === kind}
              className={
                k === kind
                  ? "rounded-md px-3 py-1.5 text-sm bg-surface shadow-sm font-medium"
                  : "rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary"
              }
            >
              {k === PRICE_KINDS.RETAIL ? "Наши магазины" : "Для клиентов"}
            </Link>
          ))}
        </div>

        <span className={stale ? "text-sm text-[#8a5a00]" : "text-sm text-ink-muted"}>
          {filled === 0
            ? "Прайс пока пуст"
            : lastChange
              ? `Обновлён ${lastChange}${
                  sinceChange === 0 ? " (сегодня)" : sinceChange !== null ? ` · ${sinceChange} дн. назад` : ""
                }${stale ? " — пора пересмотреть" : ""}`
              : `Цен: ${filled}`}
          {!canEdit && " · только просмотр"}
          <Hint>
            {kind === PRICE_KINDS.RETAIL
              ? "Внутренний прайс — цена передачи цветка в наши магазины. Это не продажа."
              : "Цена за стебель. В заявке она подставляется сама; менеджер может поменять её в заявке, отклонение видно в аналитике."}
          </Hint>
        </span>

        {canEdit && <PriceImportForm kind={kind} />}
      </div>

      <PriceBoard
        key={kind || "client"}
        flowerTypes={FLOWER_ORDER as unknown as string[]}
        varieties={varieties}
        initial={priceMapForClient(prices)}
        canEdit={canEdit}
        kind={kind}
      />

      <PriceChangesView days={changeDays} />
    </div>
  );
}
