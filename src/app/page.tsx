import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getStockSnapshot, loadStockExtras } from "@/lib/stock";
import { inStore, normalizeStore, stockStoreOfRole } from "@/lib/officeStore";
import { CLAIM_STATUSES, farmLabel, flowerTypesForFarm, getFarmFor, isFarmBoundRole, ROLES } from "@/lib/constants";
import StockBoard from "@/components/StockBoard";
import PageHeader from "@/components/PageHeader";
import KaspiAlert from "@/components/KaspiAlert";
import { Suspense } from "react";
import { HomeAttention, HomeFocusStrip, HomeStats } from "@/components/HomeFocus";
import { homeFocus } from "@/lib/homeFocus";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { listClaims } from "@/lib/repo/claims";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { localDayKey } from "@/lib/timezone";
import { MISSING_FARM_MESSAGE, missingFarm } from "@/lib/access";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { settingsMap } from "@/lib/repo/broadcasts";
import { getCurrentPrices } from "@/lib/repo/prices";
import { priceFor } from "@/lib/priceList";
import { stockMap as liveStockMap } from "@/lib/botKnowledge";
import { isNotASale } from "@/lib/orderKind";
import { parsePush, pushLineText, pushLines, pushSold, SALES_PUSH_SETTING } from "@/lib/salesPush";
import { newOrderLinksFor } from "@/lib/newOrder";
import { dayGreeting } from "@/lib/myDay/greeting";
import MyDayManager from "@/components/myday/MyDayManager";
import MyDayAccountant from "@/components/myday/MyDayAccountant";
import MyDayWarehouse from "@/components/myday/MyDayWarehouse";
import MyDayOwner from "@/components/myday/MyDayOwner";

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
  // «Лиды с рекламы»: склад, заявки и деньги ей не нужны — главная у неё это лиды.
  if (role === ROLES.LEADGEN) redirect("/clients/leads");
  if (missingFarm(role, session.user?.farm)) {
    return <div className="card max-w-xl">{MISSING_FARM_MESSAGE}</div>;
  }

  // «Мой день» (19.10.2026, макет принят владельцем): у каждой роли свой экран — то, что надо сделать сейчас.
  // Менеджер, бухгалтер, склад (и склад офиса), владелец и РОП — свои экраны; остальные пока на общей сводке ниже.
  const user = {
    email: (session.user?.email ?? "").toLowerCase(),
    name: session.user?.name ?? "",
    role,
    farm: isFarmBoundRole(role) ? session.user?.farm ?? null : null,
  };
  const DayScreen =
    role === ROLES.MANAGER
      ? MyDayManager
      : role === ROLES.ACCOUNTANT
        ? MyDayAccountant
        : role === ROLES.WAREHOUSE || role === ROLES.OFFICE || role === ROLES.OFFICE_RETAIL
          ? MyDayWarehouse
          : role === ROLES.ADMIN || role === ROLES.SALES_HEAD
            ? MyDayOwner
            : null;
  if (DayScreen) {
    const dayActions = newOrderLinksFor(role).map((l) => (
      <Link key={l.href} href={l.href} className="btn-primary">
        {l.label}
      </Link>
    ));
    return (
      <div>
        <PageHeader
          area="home"
          title={dayGreeting(user.name, new Date())}
          subtitle={user.farm ? `Производство ${farmLabel(user.farm)}` : undefined}
          actions={dayActions.length ? dayActions : undefined}
        />
        {searchParams?.error === "nofarm" && <div className="card text-sm mb-5">{MISSING_FARM_MESSAGE}</div>}
        {(role === ROLES.ADMIN || role === ROLES.ACCOUNTANT) && (
          <Suspense fallback={null}>
            <KaspiAlert />
          </Suspense>
        )}
        <DayScreen user={user} />
      </div>
    );
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
      getStockSnapshot(now, undefined, farm, { ...extras, store: stockStoreOfRole(role) })
    ),
    listOrdersWithItems(),
    listBatches(),
    getSettings(),
    withClaims ? listClaims().catch(() => []) : Promise.resolve([]),
  ]);

  const ownStore = stockStoreOfRole(role);
  const inStock = batches.filter(
    (b) =>
      b.quantityRemaining > 0 &&
      (!farm || getFarmFor(b.flowerType) === farm) &&
      (ownStore === undefined || normalizeStore(b.store) === ownStore)
  );
  const expiredStems = inStock
    .map((b) => computeBatchStorageInfo(b, settings, now))
    // «Просрочено» — то же правило, что у сводки склада ниже (`computeBatchStorageInfo`):
    // два разных числа об одном и том же на одном экране читаются как ошибка.
    .filter((i) => i.status === "critical")
    .reduce((s, i) => s + i.batch.quantityRemaining, 0);

  const focus = homeFocus({
    role,
    email: session.user?.email ?? "",
    // Склад и склад офиса видят очередь своего склада (`officeStore.ts`).
    orders: ownStore === undefined ? orders : inStore(orders, ownStore),
    todayKey: localDayKey(now),
    extras: {
      expiredStems,
      stockStems: inStock.reduce((s, b) => s + b.quantityRemaining, 0),
      openClaims: claims.filter((c) => c.status === CLAIM_STATUSES.NEW).length,
    },
  });
  const showStock = focus?.showStock ?? true;

  // «Распродаём в первую очередь» (`salesPush.ts`, 13.10.2026: «усиленно распродай 4 категорию хризантемы») —
  // тем, кто продаёт: что, сколько живого на складе, цена от объёма и сколько продали за 7 дней.
  const sells = role === ROLES.MANAGER || role === ROLES.SALES_HEAD || role === ROLES.ADMIN;
  const pushItems = sells ? parsePush((await settingsMap().catch(() => ({} as Record<string, string>)))[SALES_PUSH_SETTING]) : [];
  let pushRows: { text: string; sold7: number }[] = [];
  if (pushItems.length) {
    const prices = await getCurrentPrices(localDayKey(now)).catch(() => new Map());
    const live = Array.from(liveStockMap(inStore(batches, ""), settings, now).values());
    const todayKey = localDayKey(now);
    const weekAgo = localDayKey(new Date(now.getTime() - 6 * 86_400_000));
    pushRows = pushLines(pushItems, live, (f, v, g) => priceFor(prices, f, v, g))
      .filter((l) => l.qty > 0)
      .map((l) => ({
        text: pushLineText(l),
        sold7: pushSold(l, orders, weekAgo, todayKey, (iso) => localDayKey(new Date(iso)), (o) => !isNotASale(o)),
      }));
  }

  // Новый вид (19.10.2026, «одностраничный и удобный»): цифры своей работы строкой, ниже склад карточкой с
  // вкладками и рядом — «требует внимания». Без длинной ленты блоков друг под другом.
  const pushCard = pushRows.length > 0 && (
    <div className="card !p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-line-hairline">
        <span className="w-2 h-2 rounded-full bg-status-warning" aria-hidden />
        <h2 className="font-display text-[15px] font-bold">Распродаём в первую очередь</h2>
      </div>
      <div className="px-5 py-3 space-y-1.5">
        {pushRows.map((r) => (
          <div key={r.text} className="text-sm">
            {r.text}
            <span className="text-ink-muted"> · за 7 дней продали {r.sold7.toLocaleString("ru-RU")} шт.</span>
          </div>
        ))}
        <div className="text-xs text-ink-muted">Предлагайте первой — к любому заказу и на «дорого». Бот делает так же.</div>
      </div>
    </div>
  );
  const side = (focus?.attention !== undefined || pushCard) && (
    <div className="space-y-5">
      {focus?.attention !== undefined && <HomeAttention focus={focus} />}
      {pushCard}
    </div>
  );

  return (
    <div>
      <PageHeader
        area="home"
        title={`Здравствуйте, ${session.user?.name?.split(" ")[0] ?? ""}`}
        subtitle={farm ? `Производство ${farmLabel(farm)}` : undefined}
        actions={
          focus?.action ? (
            <Link href={focus.action.href} className="btn-primary">
              {focus.action.label}
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-5">
        {searchParams?.error === "nofarm" && <div className="card text-sm">{MISSING_FARM_MESSAGE}</div>}

        {(role === ROLES.ADMIN || role === ROLES.ACCOUNTANT) && (
          <Suspense fallback={null}>
            <KaspiAlert />
          </Suspense>
        )}

        {focus && <HomeFocusStrip focus={focus} />}
        {focus && <HomeStats focus={focus} />}

        {showStock ? (
          <div className={side ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start" : ""}>
            <StockBoard initial={snapshot} allowedTypes={flowerTypesForFarm(farm)} />
            {side}
          </div>
        ) : (
          side
        )}
      </div>
    </div>
  );
}
