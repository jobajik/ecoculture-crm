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
import KpiTile from "@/components/KpiTile";
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
    <div>
      {/* У РОПа прайс — вкладка раздела «Планы», и шапка того же цвета, что у
          соседних вкладок; у менеджера — справка в «Продажах». */}
      <PageHeader
        area={canEdit ? "plans" : "sales"}
        title="Прайс-лист"
        icon="tag"
        tabs={canEdit ? plansTabsFor(role) : salesTabsFor(role)}
        actions={
          <div className="flex items-center gap-2">
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
            <Hint>
              {kind === PRICE_KINDS.RETAIL
                ? "Внутренний прайс — цена передачи цветка в наши магазины. Это не продажа."
                : "Цена за стебель. В заявке она подставляется сама; менеджер может поменять её в заявке, отклонение видно в аналитике."}
            </Hint>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="tag"
          label="Цен в прайсе"
          value={filled.toLocaleString("ru-RU")}
          hint={filled === 0 ? "прайс пока пуст" : kind === PRICE_KINDS.RETAIL ? "внутренний прайс" : "для клиентов"}
          tone={filled === 0 ? "warn" : undefined}
        />
        <KpiTile
          icon="calendar"
          label="Обновлён"
          value={lastChange || "—"}
          hint={
            sinceChange === null
              ? undefined
              : sinceChange === 0
                ? "сегодня"
                : `${sinceChange} дн. назад${stale ? " — пора пересмотреть" : ""}`
          }
          tone={stale ? "warn" : undefined}
        />
        <KpiTile icon="chart" label="Дней с правками" value={changeDays.length.toLocaleString("ru-RU")} hint="вся история прайса" />
        <KpiTile
          icon="leaf"
          label="Сортов в справочнике"
          value={FLOWER_ORDER.reduce((sum, f) => sum + (varieties[f]?.length ?? 0), 0).toLocaleString("ru-RU")}
          hint={canEdit ? "цену можно править" : "только просмотр"}
        />
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-5">
          <PriceImportForm kind={kind} />
        </div>
      )}

      <PriceBoard
        key={kind || "client"}
        flowerTypes={FLOWER_ORDER as unknown as string[]}
        varieties={varieties}
        initial={priceMapForClient(prices)}
        canEdit={canEdit}
        kind={kind}
        history={<PriceChangesView days={changeDays} />}
      />
    </div>
  );
}
