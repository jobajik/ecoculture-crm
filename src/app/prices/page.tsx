import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCurrentPrices, listPrices } from "@/lib/repo/prices";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { FLOWER_TYPES, ROLES } from "@/lib/constants";
import { priceMapForClient } from "@/lib/priceList";
import PriceBoard from "@/components/PriceBoard";
import SectionTabs from "@/components/SectionTabs";
import { salesTabsFor } from "../sales/tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FLOWER_ORDER = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

export default async function PricesPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Смотреть прайс полезно и менеджеру — он по нему продаёт. Менять его может
  // только РОП и администратор.
  if (!role || ![ROLES.SALES_HEAD, ROLES.ADMIN, ROLES.MANAGER].includes(role as never)) {
    redirect("/");
  }
  const canEdit = role === ROLES.SALES_HEAD || role === ROLES.ADMIN;

  const [varieties, prices, all] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(),
    listPrices(),
  ]);

  const lastChange = all.map((r) => r.date).filter(Boolean).sort().pop();
  const filled = Array.from(prices.values()).filter((r) => r.price > 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Прайс-лист</h1>
        <p className="text-sm text-ink-secondary">
          Цена за стебель. Заполните строку «Все сорта» — этого хватит, чтобы оценить весь цветок;
          отдельные сорта задавайте только там, где цена отличается. Прайс подставляется в заявку
          сам, менеджер может поправить цифру вручную.
        </p>
      </div>

      <SectionTabs tabs={salesTabsFor(role)} />

      <p className="text-sm text-ink-muted">
        {filled > 0 ? `Заполнено цен: ${filled}` : "Прайс пока пуст"}
        {lastChange && ` · последнее изменение ${new Date(lastChange).toLocaleDateString("ru-RU")}`}
        {!canEdit && " · у вас доступ только на просмотр"}
      </p>

      <PriceBoard
        flowerTypes={FLOWER_ORDER as unknown as string[]}
        varieties={varieties}
        initial={priceMapForClient(prices)}
        canEdit={canEdit}
      />
    </div>
  );
}
