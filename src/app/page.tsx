import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Image from "next/image";
import { authOptions } from "@/lib/auth";
import { getStockSnapshot, loadStockExtras } from "@/lib/stock";
import { CLAIM_STATUSES, farmLabel, flowerTypesForFarm, getFarmFor, isFarmBoundRole, ROLES } from "@/lib/constants";
import StockBoard from "@/components/StockBoard";
import HomeFocusBoard, { HomeFocusStrip } from "@/components/HomeFocus";
import { homeFocus } from "@/lib/homeFocus";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { listClaims } from "@/lib/repo/claims";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { localDayKey } from "@/lib/timezone";
import { MISSING_FARM_MESSAGE, missingFarm } from "@/lib/access";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Главная — «что у вас сегодня», а не одна и та же сводка склада для всех.
 *
 * Аудит сентября: у всех ролей главная была тремя экранами остатков. Владелец
 * видел четыре цифры, которые никуда не вели, а предупреждения лежали в
 * «Аналитика → Отчёт»; бухгалтеру склад не нужен вовсе; у зав. складом очередь
 * начиналась с 3,5-го экрана. Теперь наверху — своя работа роли (`homeFocus`),
 * у владельца и РОПа — ранжированный список «Требует внимания», где каждая
 * строка ведёт в уже отфильтрованный список. Плитки «Разделы» убраны: они
 * повторяли меню.
 */
export default async function HomePage({ searchParams }: { searchParams?: { error?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Без роли — никуда (грабли 1.10): раньше здесь подставлялась роль менеджера.
  const role = session.user?.role;
  if (!role) {
    return <div className="card max-w-xl">Для вашей почты не назначена роль. Обратитесь к администратору.</div>;
  }
  if (missingFarm(role, session.user?.farm)) {
    return <div className="card max-w-xl">{MISSING_FARM_MESSAGE}</div>;
  }

  // Зав. складом и агроном привязаны к производству — им и остатки показываем
  // только по своему цветку. Остальные роли видят всё.
  const farm = isFarmBoundRole(role) ? session.user?.farm ?? null : null;
  // Бухгалтеру склад на главной не показывается (homeFocus.showStock) — прайс и
  // отгрузки ради него не читаем.
  const showStockExtras = role !== ROLES.ACCOUNTANT;
  const withClaims = role === ROLES.ADMIN || role === ROLES.ACCOUNTANT || role === ROLES.SALES_HEAD;

  // Всё, что нужно главной, — одним запросом к Google (лимит у компании общий).
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.BATCHES,
    SHEET_TABS.SETTINGS,
    ...(showStockExtras ? [SHEET_TABS.PRICE_HISTORY, SHEET_TABS.SHIPMENTS] : []),
    ...(withClaims ? [SHEET_TABS.CLAIMS] : []),
  ]);
  const now = new Date();
  const [snapshot, orders, batches, settings, claims] = await Promise.all([
    (showStockExtras ? loadStockExtras() : Promise.resolve(undefined)).then((extras) =>
      getStockSnapshot(now, undefined, farm, extras)
    ),
    listOrdersWithItems(),
    listBatches(),
    getSettings(),
    withClaims ? listClaims().catch(() => []) : Promise.resolve([]),
  ]);

  const inStock = batches.filter((b) => b.quantityRemaining > 0 && (!farm || getFarmFor(b.flowerType) === farm));
  const expiredStems = inStock
    .map((b) => computeBatchStorageInfo(b, settings, now))
    // «Просрочено» — то же правило, что у сводки склада ниже (`computeBatchStorageInfo`):
    // два разных числа об одном и том же на одном экране читаются как ошибка.
    .filter((i) => i.status === "critical")
    .reduce((s, i) => s + i.batch.quantityRemaining, 0);

  const focus = homeFocus({
    role,
    email: session.user?.email ?? "",
    orders,
    todayKey: localDayKey(now),
    extras: {
      expiredStems,
      stockStems: inStock.reduce((s, b) => s + b.quantityRemaining, 0),
      openClaims: claims.filter((c) => c.status === CLAIM_STATUSES.NEW).length,
    },
  });
  const showStock = focus?.showStock ?? true;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Здравствуйте, {session.user?.name?.split(" ")[0]}</h1>
          {farm && <p className="text-ink-secondary">Производство {farmLabel(farm)}</p>}
        </div>
        {/* Логотип компании — только на широком экране, чтобы не съедать место на телефоне. */}
        <Image
          src="/logo.png"
          alt="Eco Culture"
          width={1020}
          height={593}
          priority
          className="hidden sm:block w-32 h-auto shrink-0"
        />
      </div>

      {searchParams?.error === "nofarm" && <div className="card text-sm">{MISSING_FARM_MESSAGE}</div>}

      {focus && !focus.aboveStock && <HomeFocusStrip focus={focus} />}

      {focus?.aboveStock && <HomeFocusBoard focus={focus} />}

      {showStock && <StockBoard initial={snapshot} allowedTypes={flowerTypesForFarm(farm)} />}

      {focus && !focus.aboveStock && <HomeFocusBoard focus={focus} />}
    </div>
  );
}
