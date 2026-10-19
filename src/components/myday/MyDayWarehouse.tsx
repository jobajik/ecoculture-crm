import Link from "next/link";
import type { DayUser } from "@/lib/myDay/greeting";
import { buildWarehouseDay, type DayQueueRow } from "@/lib/myDay/warehouse";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { listShipments } from "@/lib/repo/shipments";
import { getSettings } from "@/lib/repo/settings";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { isOfficeRole } from "@/lib/officeStore";
import KpiTile from "../KpiTile";
import Pill from "../Pill";
import DayCard, { DayEmpty, DayGroup, DayRow } from "./DayCard";

/**
 * «Мой день» склада (19.10.2026, макет принят владельцем): сверху четыре плитки, слева очередь на отгрузку
 * группами «опаздывают / сегодня / завтра» с кнопкой «Отгрузить», справа склад по длинам с полоской срока, кто
 * ждёт подтверждения и что принято утром. Зав. складом производства видит свой цветок, склад офиса — офис
 * (`buildWarehouseDay`). Цифры считает чистая функция под `scripts/check-myday-warehouse.ts`.
 */
const num = (n: number) => n.toLocaleString("ru-RU");

function QueueRow({ row, late = false }: { row: DayQueueRow; late?: boolean }) {
  return (
    <DayRow
      right={
        <>
          {late && <Pill tone="bad">{row.delivery}</Pill>}
          <Pill tone="good">{row.ready}</Pill>
          <Link href={row.href} className="btn-primary !py-1.5 !min-h-[36px] text-[13px]">
            Отгрузить
          </Link>
        </>
      }
    >
      <div className="font-semibold text-sm">
        <Link href={`/orders/${encodeURIComponent(row.orderId)}`} className="hover:underline">
          {row.client}
        </Link>
        <span className="font-display text-[12px] text-section-stock ml-1.5">№ {row.code}</span>
        {row.note && <span className="text-ink-muted font-normal"> · {row.note}</span>}
      </div>
      <div className="text-[13px] text-ink-secondary truncate" title={row.lines}>
        {row.lines} <span className="text-ink-muted">· {num(row.stems)} шт.</span>
      </div>
    </DayRow>
  );
}

export default async function MyDayWarehouse({ user }: { user: DayUser }) {
  const office = isOfficeRole(user.role);
  // Всё одним чтением (грабли 1.17): заявки с позициями, партии, отгрузки за темп недели, сроки хранения.
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.BATCHES, SHEET_TABS.SHIPMENTS, SHEET_TABS.SETTINGS]);
  const now = new Date();
  const [orders, batches, shipments, settings] = await Promise.all([listOrdersWithItems(), listBatches(), listShipments(), getSettings()]);
  const day = buildWarehouseDay({
    role: user.role,
    farm: user.farm,
    email: user.email,
    orders,
    batches,
    shipments,
    settings,
    today: localDayKey(now),
    now,
  });
  const { tiles, queue } = day;

  const queueHref = office ? "/office/ship" : "/warehouse";
  const batchesHref = office ? "/office" : "/warehouse/batches";
  const readyTotal = queue.late.length + queue.today.length + queue.tomorrow.length + queue.laterCount + queue.nodateCount;
  const summary = [
    tiles.todayOrders > 0 ? `сегодня к отгрузке ${tiles.todayOrders} ${plural(tiles.todayOrders, "заявка", "заявки", "заявок")} на ${num(tiles.todayStems)} шт.` : "на сегодня отгружать нечего",
    tiles.late > 0 ? `${tiles.late} ${plural(tiles.late, "опаздывает", "опаздывают", "опаздывают")}` : "",
    tiles.waiting > 0 ? `${tiles.waiting} ${plural(tiles.waiting, "ждёт", "ждут", "ждут")} подтверждения` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-sm text-ink-secondary first-letter:uppercase">{summary}</div>
        <div className="flex gap-2 ml-auto">
          {!office && (
            <Link href="/warehouse/receive" className="btn-secondary">
              Принять срезку
            </Link>
          )}
          {!office && (
            <Link href="/warehouse/picklist" className="btn-secondary">
              Лист сборки на сегодня
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiTile
          icon="truck"
          label="К отгрузке сегодня"
          value={num(tiles.todayOrders)}
          hint={tiles.todayOrders > 0 ? `${num(tiles.todayStems)} шт.` : "готовых на сегодня нет"}
          href={queueHref}
        />
        <KpiTile
          icon="alert"
          label="Опаздывают"
          value={num(tiles.late)}
          hint={tiles.late > 0 ? `${num(tiles.lateStems)} шт. · доставка прошла` : "опозданий нет"}
          tone={tiles.late > 0 ? "bad" : "good"}
          href={queueHref}
        />
        <KpiTile
          icon="clock"
          label="Ждут подтверждения"
          value={num(tiles.waiting)}
          hint={tiles.waiting > 0 ? "трогать нельзя — менеджер или оплата" : "все готовые уже в очереди"}
          tone={tiles.waiting > 0 ? "warn" : undefined}
          href={queueHref}
        />
        <KpiTile
          icon="box"
          label={office ? "В офисе" : "На складе"}
          value={num(tiles.stockStems)}
          hint={
            tiles.criticalStems > 0
              ? `${num(tiles.criticalStems)} дольше срока${tiles.coverDays !== null ? ` · хватит на ${Math.round(tiles.coverDays)} дн.` : ""}`
              : tiles.coverDays !== null
                ? `всё в сроке · хватит на ${Math.round(tiles.coverDays)} дн.`
                : "всё в сроке"
          }
          tone={tiles.criticalStems > 0 ? "bad" : tiles.warningStems > 0 ? "warn" : "good"}
          href={batchesHref}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-5 items-start">
        <div className="xl:col-span-3 min-w-0">
          <DayCard
            tone="stock"
            icon="truck"
            title="Очередь на отгрузку"
            count={readyTotal}
            hint="только готовые: обе галочки или в долг по условиям клиента"
            link={{ href: queueHref, label: "Вся очередь" }}
          >
            {readyTotal === 0 && <DayEmpty>Готовых к отгрузке заявок нет{tiles.waiting > 0 ? " — есть только ждущие подтверждения, они ниже." : "."}</DayEmpty>}
            {queue.late.length > 0 && (
              <>
                <DayGroup tone="bad">Опаздывают · {queue.late.length}</DayGroup>
                {queue.late.map((r) => (
                  <QueueRow key={r.orderId} row={r} late />
                ))}
              </>
            )}
            {queue.today.length > 0 && (
              <>
                <DayGroup>Сегодня · {queue.today.length}</DayGroup>
                {queue.today.map((r) => (
                  <QueueRow key={r.orderId} row={r} />
                ))}
              </>
            )}
            {queue.tomorrow.length > 0 && (
              <>
                <DayGroup>Завтра · {queue.tomorrow.length}</DayGroup>
                {queue.tomorrow.slice(0, 3).map((r) => (
                  <QueueRow key={r.orderId} row={r} />
                ))}
                {queue.tomorrow.length > 3 && (
                  <div className="px-4 sm:px-5 py-2.5 text-[13px] border-t border-line-hairline">
                    <Link href={queueHref} className="font-semibold text-accent">
                      Ещё {queue.tomorrow.length - 3} на завтра →
                    </Link>
                  </div>
                )}
              </>
            )}
            {(queue.laterCount > 0 || queue.nodateCount > 0) && (
              <DayGroup>
                <span className="inline-flex flex-wrap gap-x-3">
                  {queue.laterCount > 0 && (
                    <span>
                      Позже · {queue.laterCount} {plural(queue.laterCount, "заявка", "заявки", "заявок")} · {num(queue.laterStems)} шт.
                    </span>
                  )}
                  {queue.nodateCount > 0 && <span>Без даты доставки · {queue.nodateCount}</span>}
                  <Link href={queueHref} className="normal-case tracking-normal font-semibold text-accent">
                    показать
                  </Link>
                </span>
              </DayGroup>
            )}
          </DayCard>
        </div>

        <div className="xl:col-span-2 min-w-0 space-y-5">
          <DayCard
            tone="stock"
            icon="box"
            title={office ? "В офисе сейчас" : "Склад сейчас"}
            hint={office ? "по длине и категории" : "по длине и категории"}
            link={{ href: batchesHref, label: office ? "Склад офиса" : "Партии" }}
            flush={false}
          >
            {tiles.stockStems === 0 ? (
              <div className="text-sm text-ink-secondary">{office ? "В офисе пусто — цветок приходит перемещением со склада." : "На складе пусто."}</div>
            ) : (
              <>
                <div className="flex h-2 rounded-full overflow-hidden bg-surface-sunk" role="img" aria-label={shelfAria(tiles)}>
                  <div className="bg-status-good" style={{ width: `${pct(tiles.stockStems - tiles.criticalStems - tiles.warningStems, tiles.stockStems)}%` }} />
                  <div className="bg-status-warning" style={{ width: `${pct(tiles.warningStems, tiles.stockStems)}%` }} />
                  <div className="bg-status-critical" style={{ width: `${pct(tiles.criticalStems, tiles.stockStems)}%` }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2 mb-3">
                  <span>
                    <b className="text-[#157a4b]">{num(tiles.stockStems - tiles.criticalStems - tiles.warningStems)}</b> <span className="text-ink-muted">в сроке</span>
                  </span>
                  <span>
                    <b className="text-[#8a5a00]">{num(tiles.warningStems)}</b> <span className="text-ink-muted">скоро</span>
                  </span>
                  <span>
                    <b className="text-status-critical">{num(tiles.criticalStems)}</b> <span className="text-ink-muted">дольше срока</span>
                  </span>
                </div>
                <div className="divide-y divide-line-hairline/70">
                  {day.grades.slice(0, 6).map((g) => (
                    <div key={g.key} className="grid grid-cols-[minmax(0,1fr)_72px_110px] gap-3 items-center py-1.5 text-[13px]">
                      <span className="truncate">{g.label}</span>
                      <span className="font-display font-bold text-right tabular-nums">{num(g.qty)}</span>
                      <span className="flex h-2 rounded-full overflow-hidden bg-surface-sunk" aria-hidden="true">
                        <span className="bg-status-good" style={{ width: `${Math.round(g.ok * 100)}%` }} />
                        <span className="bg-status-warning" style={{ width: `${Math.round(g.warning * 100)}%` }} />
                        <span className="bg-status-critical" style={{ width: `${Math.round(g.critical * 100)}%` }} />
                      </span>
                    </div>
                  ))}
                </div>
                {day.grades.length > 6 && (
                  <div className="text-xs text-ink-muted mt-2">
                    Ещё {day.grades.length - 6} —{" "}
                    <Link href={batchesHref} className="text-accent font-semibold">
                      весь склад
                    </Link>
                  </div>
                )}
              </>
            )}
          </DayCard>

          <DayCard tone="warn" icon="clock" title="Ждут подтверждения" count={day.waiting.length} countTone="wait" hint="чего ждём" link={{ href: queueHref, label: "Все" }}>
            {day.waiting.length === 0 && <DayEmpty>Никто не ждёт — всё, что оформлено, уже готово к сборке.</DayEmpty>}
            {day.waiting.slice(0, 5).map((r) => (
              <DayRow key={r.orderId} right={<Pill tone={r.lateDays > 0 ? "bad" : "wait"}>{r.reason.replace(/^Ждёт /, "")}</Pill>}>
                <div className="text-sm">
                  <Link href={r.href} className="font-semibold hover:underline">
                    {r.client}
                  </Link>
                  <span className="text-ink-muted">
                    {" "}
                    · № {r.code} · {r.delivery}
                  </span>
                </div>
              </DayRow>
            ))}
            {day.waiting.length > 5 && (
              <div className="px-4 sm:px-5 py-2.5 text-[13px] border-t border-line-hairline">
                <Link href={queueHref} className="font-semibold text-accent">
                  Ещё {day.waiting.length - 5} →
                </Link>
              </div>
            )}
          </DayCard>

          {!office && (
            <DayCard tone="good" icon="leaf" title="Принято сегодня" count={day.received.length} link={{ href: "/warehouse/receive", label: "Приёмка" }}>
              {day.received.length === 0 && <DayEmpty>Сегодня срезку ещё не принимали.</DayEmpty>}
              {day.received.slice(0, 6).map((r) => (
                <DayRow
                  key={r.batchId}
                  right={
                    <>
                      {r.duplicate && <Pill tone="wait">похоже на повтор</Pill>}
                      <span className="font-display font-bold text-sm tabular-nums">+ {num(r.qty)}</span>
                    </>
                  }
                >
                  <div className="text-sm">
                    {r.label}
                    {r.time && <span className="text-ink-muted"> · {r.time}</span>}
                  </div>
                </DayRow>
              ))}
            </DayCard>
          )}
        </div>
      </div>
    </div>
  );
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function shelfAria(t: { stockStems: number; warningStems: number; criticalStems: number }): string {
  return `Склад по сроку: в сроке ${pct(t.stockStems - t.warningStems - t.criticalStems, t.stockStems)} %, скоро ${pct(t.warningStems, t.stockStems)} %, дольше срока ${pct(t.criticalStems, t.stockStems)} %`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
