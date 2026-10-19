"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { OrderWithItems } from "@/lib/types";
import OrderStageBadge from "./OrderStageBadge";
import ItemsCell from "./ItemsCell";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
import { formatDay } from "@/lib/formatDate";
import { byUrgency, orderStage, STAGE_LABELS, STAGE_ORDER, type OrderStage } from "@/lib/orderStage";
import { personName, type NameByEmail } from "@/lib/personName";
import DeleteOrder from "./DeleteOrder";
import { managerOptions } from "@/lib/financeManagers";
import { orderCode } from "@/lib/paymentStage";
import { matchesOrderListSearch } from "@/lib/orderListSearch";
import type { PayState } from "@/lib/orderPay";
import { formatGrade } from "@/lib/constants";
import Pill from "./Pill";
import Icon, { type IconName } from "./Icon";
import clsx from "clsx";

/** Фильтр списка: этап заявки, «опаздывают» или все. */
export const STAGE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Все заявки" },
  { value: "open", label: "Открытые" },
  { value: "late", label: "Опаздывают" },
  { value: "nodate", label: "Без даты доставки" },
  ...STAGE_ORDER.map((k) => ({ value: k, label: STAGE_LABELS[k] })),
];

/**
 * Список заявок.
 *
 * **Строки одной высоты — это не про красоту.** В заявке бывает одна позиция, а
 * бывает девять, и колонка «Позиции» растягивала строку на четыре ряда текста.
 * Соседние строки при этом оставались в один ряд, и глаз, идущий по списку
 * сверху вниз, каждый раз терял, где он: колонка «Сумма» одной заявки
 * оказывалась на уровне «Клиента» соседней. Владелец прислал снимок именно с
 * этим.
 *
 * Поэтому каждая ячейка теперь занимает **ровно одну строку текста**: длинное
 * имя клиента и длинная причина обрезаются (полный текст — во всплывающей
 * подсказке), номер заявки не переносится, а позиции свёрнуты до первой плюс
 * «ещё N». Развернуть можно любую строку по отдельности — тогда она и станет
 * выше, но это будет осознанным действием человека, а не сюрпризом.
 *
 * Свёрнута именно ПЕРВАЯ позиция, а не «Розы, 9 позиций»: в девяти случаях из
 * десяти заявка про один цветок, и первая строка отвечает на вопрос «что это»
 * без раскрытия. Число рядом отвечает на второй вопрос — «а сколько там ещё».
 */
export default function OrdersTable({
  orders,
  managerNames = {},
  today,
  initialFilter = "all",
  initialManager = "",
  initialSearch = "",
  viewerRole = "",
  viewerEmail = "",
  canAdmin = false,
  payStates = {},
}: {
  orders: OrderWithItems[];
  /** Деньги по заявке (`orderPayState`, считается на сервере). */
  payStates?: Record<string, PayState>;
  /** Почта → имя из вкладки `Users`. Без неё в колонке стоял бы адрес. */
  managerNames?: NameByEmail;
  /** Сегодня по Алматы — от сервера, чтобы опоздание не зависело от часов телефона. */
  today: string;
  /** Фильтр из адреса (`?stage=late`) — плитки главной ведут сразу в нужный список. */
  initialFilter?: string;
  /** Менеджер из адреса (`?manager=почта`). */
  initialManager?: string;
  /** Поиск из адреса (`?q=`). */
  initialSearch?: string;
  /** Кто смотрит: менеджер по умолчанию видит свои заявки. */
  viewerRole?: string;
  viewerEmail?: string;
  /** Администратор: «изменить» и «удалить» прямо в строке списка. */
  canAdmin?: boolean;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(
    STAGE_FILTERS.some((f) => f.value === initialFilter) ? initialFilter : "all"
  );
  const [search, setSearch] = useState(initialSearch);
  // Фильтр по менеджеру (12.10.2026, владелец: «в заявках сделай фильтр по менеджерам»).
  const managers = useMemo(
    () => managerOptions(orders.map((o) => ({ managerEmail: o.managerEmail.toLowerCase(), managerName: personName(o.managerEmail, managerNames) }))),
    [orders, managerNames]
  );
  // Менеджер по умолчанию видит свои заявки; «Все менеджеры» — `?manager=all`.
  const me = viewerEmail.toLowerCase();
  const defaultManager = viewerRole === "manager" && managers.some((x) => x.email === me) ? me : "";
  const [manager, setManager] = useState<string>(() => {
    const m = initialManager.toLowerCase();
    if (m === "all") return "";
    if (!m) return defaultManager;
    return managers.some((x) => x.email === m) ? m : "";
  });

  // Фильтры живут в адресе: «Назад» со страницы заявки возвращает тот же список.
  // replaceState, а не router.replace: тот перечитывал бы страницу с сервера
  // (все заявки из Google) на каждую букву поиска.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const set = (key: string, value: string) => {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      };
      set("stage", status === "all" ? "" : status);
      set("manager", manager === defaultManager ? "" : manager || "all");
      set("q", search.trim());
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
    } catch {
      // адрес — удобство, список работает и без него
    }
  }, [status, manager, search, defaultManager]);

  // Этап считается один раз на заявку: им пользуются фильтр, сортировка и бейдж.
  const stages = useMemo(() => {
    const m = new Map<string, OrderStage>();
    for (const o of orders) m.set(o.orderId, orderStage(o, today));
    return m;
  }, [orders, today]);
  const stageOf = (o: OrderWithItems) => stages.get(o.orderId)!;

  const filtered = useMemo(() => {
    const list = orders.filter((o) => {
      const st = stages.get(o.orderId)!;
      if (manager && o.managerEmail.toLowerCase() !== manager) return false;
      if (status === "open" && (st.key === "shipped" || st.key === "cancelled")) return false;
      if (status === "late" && st.lateDays <= 0) return false;
      if (status === "nodate" && (o.deliveryDate || st.key === "shipped" || st.key === "cancelled")) return false;
      if (!["all", "open", "late", "nodate"].includes(status) && st.key !== status) return false;
      if (search.trim() && !matchesOrderListSearch(o, personName(o.managerEmail, managerNames), search)) return false;
      return true;
    });
    // В рабочих отборах — сначала те, что опаздывают сильнее всего.
    return status === "all" ? list : [...list].sort(byUrgency((o: OrderWithItems) => stages.get(o.orderId)!));
  }, [orders, stages, status, search, manager, managerNames]);

  // Заявок со временем накопится много. Показываем начало списка, остальное по
  // кнопке; при поиске и фильтре по статусу показываем всё найденное — там
  // список человек сузил сам.
  const [expanded, setExpanded] = useState(false);
  const narrowed = status !== "all" || search.trim().length > 0 || (manager !== "" && manager !== defaultManager);
  // Итог выбранного менеджера: заявки и сумма (отменённые в сумму не идут).
  const managerTotal = manager
    ? filtered.filter((o) => stageOf(o).key !== "cancelled").reduce((sum, o) => sum + o.totalAmount, 0)
    : 0;
  const shown = expanded || narrowed ? filtered : filtered.slice(0, COLLAPSED_TABLE_SIZE);
  const hidden = filtered.length - shown.length;

  const itemText = (i: OrderWithItems["items"][number]) =>
    `${i.variety}, ${formatGrade(i.grade)} · ${i.quantity.toLocaleString("ru-RU")}`;

  // Плитки и счётчики фильтров (новый вид, 19.10.2026) — по заявкам выбранного менеджера, без поиска.
  const base = manager ? orders.filter((o) => o.managerEmail.toLowerCase() === manager) : orders;
  const month = today.slice(0, 7);
  const tomorrow = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  let monthCount = 0;
  let monthSum = 0;
  let shipToday = 0;
  let lateCount = 0;
  let waitSum = 0;
  let overdueSum = 0;
  const counts: Record<string, number> = {};
  for (const o of base) {
    const st = stageOf(o);
    const pay = payStates[o.orderId];
    counts.all = (counts.all ?? 0) + 1;
    counts[st.key] = (counts[st.key] ?? 0) + 1;
    const open = st.key !== "shipped" && st.key !== "cancelled";
    if (open) counts.open = (counts.open ?? 0) + 1;
    if (st.lateDays > 0) counts.late = (counts.late ?? 0) + 1;
    if (open && !o.deliveryDate) counts.nodate = (counts.nodate ?? 0) + 1;
    if (o.createdAt.slice(0, 7) === month && st.key !== "cancelled") {
      monthCount += 1;
      if (pay?.sale) monthSum += o.totalAmount;
    }
    if ((st.key === "ready" || st.key === "partly") && o.deliveryDate === today) shipToday += 1;
    if (open && st.lateDays > 0) lateCount += 1;
    if (pay?.sale) {
      waitSum += pay.debt;
      if (pay.late) overdueSum += pay.debt;
    }
  }
  const chips: { value: string; label: string }[] = [
    { value: "all", label: "Все" },
    { value: "open", label: "Открытые" },
    { value: "wait_confirm", label: "Ждут подтверждения" },
    { value: "wait_money", label: "Ждут оплату" },
    { value: "ready", label: "Готовы к отгрузке" },
    { value: "late", label: "Опаздывают" },
    { value: "nodate", label: "Без даты" },
    { value: "partly", label: "Частично отгружены" },
    { value: "shipped", label: "Отгружены" },
    { value: "cancelled", label: "Отменены" },
  ];
  const deliveryLabel = (d: string) => (!d ? "—" : d === today ? "сегодня" : d === tomorrow ? "завтра" : formatDay(d));
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";
  const short = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₸` : `${Math.round(v).toLocaleString("ru-RU")} ₸`;

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <Tile icon="order" label="Заявок за месяц" value={monthCount.toLocaleString("ru-RU")} hint="без отменённых" />
        <Tile icon="wallet" label="На сумму" value={short(monthSum)} hint="продажи месяца" />
        <Tile
          icon="truck"
          label="К отгрузке сегодня"
          value={shipToday.toLocaleString("ru-RU")}
          hint={lateCount > 0 ? `${lateCount} опаздывают` : "опозданий нет"}
          bad={lateCount > 0}
          onClick={lateCount > 0 ? () => setStatus("late") : undefined}
        />
        <Tile
          icon="clock"
          label="Ждём оплату"
          value={short(waitSum)}
          hint={overdueSum > 0 ? `из них ${short(overdueSum)} просрочено` : "просрочки нет"}
          bad={overdueSum > 0}
        />
      </div>

      {manager && (
        <p className="mb-3 text-sm text-ink-secondary">
          {managers.find((m) => m.email === manager)?.name}: заявок {filtered.length.toLocaleString("ru-RU")}
          {managerTotal > 0 ? ` на ${Math.round(managerTotal).toLocaleString("ru-RU")} ₸` : ""}
          <span className="text-ink-muted"> · без отменённых в сумме</span>
        </p>
      )}
      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
          <div className="flex gap-2 overflow-x-auto scroll-x-hidden xl:flex-wrap -mx-1 px-1">
            {chips
              .filter((c) => c.value === "all" || c.value === status || (counts[c.value] ?? 0) > 0)
              .map((c) => {
                const on = status === c.value;
                const n = counts[c.value] ?? 0;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setStatus(c.value)}
                    className={clsx(
                      "h-8 px-3 rounded-full border text-[13px] whitespace-nowrap flex items-center gap-1.5 transition-colors flex-none",
                      on
                        ? "bg-ink-primary text-white border-ink-primary"
                        : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
                    )}
                  >
                    {c.label}
                    <b className={clsx("font-semibold tabular-nums", !on && c.value === "late" && "text-status-critical")}>
                      {n.toLocaleString("ru-RU")}
                    </b>
                  </button>
                );
              })}
          </div>
          <div className="flex gap-2 xl:ml-auto xl:flex-none">
            <input
              className="input !w-auto flex-1 xl:w-[220px] min-w-0"
              placeholder="Клиент, телефон, сорт, №"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {managers.length > 1 && (
              <select
                id="orders-manager"
                aria-label="Менеджер"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                className="input !w-auto"
              >
                <option value="">Все менеджеры</option>
                {managers.map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-3 py-2.5 font-medium">№</th>
              <th className="px-3 py-2.5 font-medium">Клиент</th>
              <th className="px-3 py-2.5 font-medium">Доставка</th>
              <th className="px-3 py-2.5 font-medium">Что заказали</th>
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
              <th className="px-3 py-2.5 font-medium">Оплата</th>
              <th className="px-3 py-2.5 font-medium">Этап</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => {
              const stage = stageOf(o);
              const pay = payStates[o.orderId];
              const mName = personName(o.managerEmail, managerNames);
              return (
                <Fragment key={o.orderId}>
                <tr
                  className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top"
                >
                  <td className="px-3 py-3">
                    {/* Номер не переносится: «ORD-260914-T85ZC» ломался на три
                        строки и в одиночку задирал высоту всей строки. */}
                    <Link
                      href={`/orders/${o.orderId}`}
                      className="text-ink-secondary hover:text-accent font-medium whitespace-nowrap font-mono text-[12.5px]"
                      title={o.orderId}
                    >
                      {orderCode(o.orderId)}
                    </Link>
                    <div className="text-xs text-ink-muted whitespace-nowrap">
                      {formatDay(o.createdAt)}
                      {o.store === "office" && <span className="ml-1.5 text-section-stock font-medium">· офис</span>}
                    </div>
                    {/* Действия админа — под номером, а не отдельной колонкой:
                        лишняя колонка вылезала за край (боковой прокрутки в
                        таблицах нет — см. CLAUDE.md). */}
                    {canAdmin && (
                      <div className="mt-1 flex gap-1 text-xs whitespace-nowrap">
                        <Link
                          href={`/orders/${o.orderId}/edit`}
                          className="rounded px-1.5 py-0.5 text-ink-secondary hover:bg-surface-sunk hover:text-accent"
                          title="Изменить заявку"
                        >
                          ✎
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleting(deleting === o.orderId ? null : o.orderId)}
                          className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-status-critical/10 hover:text-status-critical"
                          title="Удалить заявку"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3" data-label="Клиент">
                    <Link href={`/orders/${o.orderId}`} className="block truncate max-w-[220px] font-semibold hover:text-accent" title={o.clientName}>
                      {o.clientName || "—"}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-ink-secondary min-w-0">
                      <span className="w-5 h-5 rounded-full bg-accent-soft text-accent grid place-items-center text-[9px] font-bold flex-none">
                        {initials(mName)}
                      </span>
                      <span className="truncate max-w-[160px]">{mName}</span>
                    </div>
                  </td>
                  <td
                    className={clsx("px-3 py-3 whitespace-nowrap", stage.lateDays > 0 ? "text-status-critical font-semibold" : "text-ink-secondary")}
                    data-label="Доставка"
                  >
                    {deliveryLabel(o.deliveryDate)}
                    {stage.lateDays > 0 && <div className="text-xs font-normal">опаздывает {stage.lateDays} дн.</div>}
                  </td>
                  <td className="px-3 py-3 text-ink-secondary" data-label="Что заказали">
                    <ItemsCell lines={o.items.map(itemText)} />
                  </td>
                  <td className="px-3 py-3 font-semibold sm:text-right whitespace-nowrap tabular-nums" data-label="Сумма">
                    {o.totalAmount.toLocaleString("ru-RU")} ₸
                  </td>
                  <td className="px-3 py-3" data-label="Оплата">
                    {pay && pay.tone !== "muted" ? <Pill tone={pay.tone}>{pay.label}</Pill> : <span className="text-ink-muted text-xs">{pay?.label ?? "—"}</span>}
                  </td>
                  {/* Один этап вместо пары «статус + готовность» (`orderStage`). */}
                  <td className="px-3 py-3" data-label="Этап">
                    <OrderStageBadge stage={{ ...stage, lateDays: 0 }} compact />
                    {stage.actor && (
                      <div className="text-xs text-ink-muted mt-1 whitespace-nowrap">ход: {stage.actor}</div>
                    )}
                  </td>
                </tr>
                {canAdmin && deleting === o.orderId && (
                  <tr className="border-b border-line-hairline">
                    <td colSpan={7} className="px-3 py-3 bg-surface-plane">
                      <DeleteOrder
                        inline
                        orderId={o.orderId}
                        paidAmount={o.paidAmount}
                        shippedStems={o.items.reduce((sum, i) => sum + (i.shippedQuantity || 0), 0)}
                        onClose={() => setDeleting(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  Заявок не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {(hidden > 0 || (expanded && !narrowed)) && (
        <div className="mt-2 flex items-center gap-3">
          <MoreToggle
            expanded={expanded}
            hidden={hidden}
            onToggle={() => setExpanded((v) => !v)}
            what="заявок"
          />
          <span className="text-xs text-ink-muted">
            всего заявок: {filtered.length.toLocaleString("ru-RU")}
          </span>
        </div>
      )}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  bad,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: string;
  hint: string;
  bad?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Icon name={icon} className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="font-display font-extrabold text-[22px] sm:text-[26px] tabular-nums mt-1.5 leading-none">{value}</div>
      <div className={clsx("text-xs mt-2", bad ? "text-status-critical font-semibold" : "text-ink-secondary")}>{hint}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card !p-4 sm:!p-5 text-left hover:shadow-card-hover transition-shadow">
      {body}
    </button>
  ) : (
    <div className="card !p-4 sm:!p-5">{body}</div>
  );
}
