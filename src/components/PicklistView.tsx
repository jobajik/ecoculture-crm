"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { FARM_ORDER, FLOWER_TYPE_LABELS_PLURAL, farmLabel, formatGrade } from "@/lib/constants";
import type { Picklist, PicklistLine, PicklistOrder } from "@/lib/picklist";
import { orders as orderWord } from "@/lib/plural";

const TYPE_ORDER = ["rose", "chrysanthemum", "eustoma"];

/** «Айгерим Смагулова» → «Айгерим С.» — в шапке места мало. */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0]} ${parts[1][0]}.`;
}

// Печатная область листа A4 (альбомная) при 96 dpi: 297×210 мм минус поля 8 мм
// с каждой стороны → 281×194 мм → 1062×733 px. Берём с небольшим запасом, чтобы
// ничего не срезалось по краю. Документ верстается в этих пикселях, а затем
// ужимается ровно настолько, чтобы влезть на один лист целиком.
const PAGE_WIDTH = 1052;
const PAGE_HEIGHT = 724;

/** «11 сент., чт» — коротко, но с днём недели: по нему и ориентируются. */
function shortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    weekday: "short",
  });
}

export default function PicklistView({
  picklist,
  canSwitchFarm = false,
}: {
  picklist: Picklist;
  /** Администратор может смотреть лист любого производства или сводно. */
  canSwitchFarm?: boolean;
}) {
  const router = useRouter();
  const docRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const fit = useCallback(() => {
    const el = docRef.current;
    if (!el) return;
    const next = Math.min(1, PAGE_HEIGHT / el.scrollHeight, PAGE_WIDTH / el.scrollWidth);
    setScale(Number.isFinite(next) && next > 0 ? next : 1);
  }, []);

  useEffect(() => {
    fit();
    // Шрифт может догрузиться после первой отрисовки — пересчитываем.
    const timer = setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    window.addEventListener("beforeprint", fit);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", fit);
      window.removeEventListener("beforeprint", fit);
    };
  }, [fit, picklist]);

  // Клиенты становятся колонками и группируются по менеджерам — так на листе
  // сразу видно, чьи это заявки, и не нужно сверяться с легендой.
  const clients = [...picklist.orders].sort(
    (a, b) =>
      a.managerName.localeCompare(b.managerName, "ru") ||
      a.clientName.localeCompare(b.clientName, "ru")
  );

  const managerGroups: { manager: string; count: number; stems: number }[] = [];
  for (const c of clients) {
    const last = managerGroups[managerGroups.length - 1];
    if (last && last.manager === c.managerName) {
      last.count += 1;
      last.stems += c.totalStems;
    } else {
      managerGroups.push({ manager: c.managerName, count: 1, stems: c.totalStems });
    }
  }
  const byType = TYPE_ORDER.map((type) => ({
    type,
    lines: picklist.lines.filter((l) => l.flowerType === type),
  })).filter((group) => group.lines.length > 0);

  const tooSmall = scale < 0.55;
  // При четырёх и более клиентах имена в шапке ставим вертикально: колонка
  // остаётся узкой, а имя читается целиком и не превращается в номер.
  const vertical = clients.length >= 4;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Заявка на сборку</h1>
          <p className="text-ink-secondary text-sm">
            Один лист A4, альбомный: строки — позиции, колонки — клиенты.
            {scale < 1 && (
              <span className="text-ink-muted"> Масштаб печати {Math.round(scale * 100)}%.</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Дата доставки</label>
            <input
              type="date"
              className="input !w-auto"
              value={picklist.date}
              onChange={(e) =>
                router.push(
                  `/warehouse/picklist?date=${e.target.value}` +
                    (picklist.farm ? `&farm=${picklist.farm}` : "")
                )
              }
            />
          </div>
          {canSwitchFarm && (
            <div>
              <label className="label">Производство</label>
              <select
                className="input !w-auto"
                value={picklist.farm ?? ""}
                onChange={(e) =>
                  router.push(
                    `/warehouse/picklist?date=${picklist.date}` +
                      (e.target.value ? `&farm=${e.target.value}` : "")
                  )
                }
              >
                <option value="">Все производства</option>
                {FARM_ORDER.map((f) => (
                  <option key={f} value={f}>
                    {farmLabel(f)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <a
            href={`/api/warehouse/picklist?date=${picklist.date}${picklist.farm ? `&farm=${picklist.farm}` : ""}`}
            className="btn-secondary"
          >
            Excel
          </a>
          <button onClick={() => window.print()} className="btn-primary">
            Печать
          </button>
        </div>
      </div>

      {tooSmall && (
        <div className="no-print text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          На этот день столько заявок, что лист ужимается до {Math.round(scale * 100)}% — на бумаге
          будет мелко. Лучше напечатать на A3 или разделить день на две отгрузки.
        </div>
      )}

      {picklist.totalOrders === 0 ? (
        <div className="card py-8 no-print text-center">
          <p className="font-medium">На эту дату заявок нет</p>
          {picklist.nearbyDates.length > 0 ? (
            <>
              <p className="text-sm text-ink-secondary mt-1">
                Лист открывается на сегодня, а доставку чаще ставят на другой день. Вот когда
                заявки есть — нажмите на дату:
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {picklist.nearbyDates.map((d) => (
                  <button
                    key={d.date}
                    onClick={() =>
                      router.push(
                        `/warehouse/picklist?date=${d.date}` +
                          (picklist.farm ? `&farm=${picklist.farm}` : "")
                      )
                    }
                    className="btn-secondary !py-1.5 text-sm"
                  >
                    {shortDate(d.date)}
                    <span className="text-ink-muted">
                      {" · "}
                      {orderWord(d.orders)}, {d.stems.toLocaleString("ru-RU")} шт.
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : picklist.ordersWithoutDate.length > 0 ? (
            <p className="text-sm text-ink-secondary mt-1">
              Заявки есть, но у них не проставлена дата доставки — они перечислены ниже. Дату
              ставит менеджер на своей заявке.
            </p>
          ) : (
            <p className="text-sm text-ink-secondary mt-1">
              Заявок пока нет вовсе — ни на этот день, ни на другие. Лист появится, как только
              менеджеры оформят первые.
            </p>
          )}
        </div>
      ) : (
        <div className="doc-frame overflow-x-auto">
          <div
            ref={docRef}
            className="doc bg-surface text-ink-primary"
            style={{ width: PAGE_WIDTH, ["--print-scale" as string]: String(scale) }}
          >
            {/* Шапка */}
            <div className="flex items-end justify-between gap-6 border-b-2 border-ink-primary pb-1.5">
              <div className="flex items-baseline gap-3">
                <h2 className="text-xl font-bold leading-none">ЗАЯВКА НА СБОРКУ</h2>
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  {picklist.farm ? farmLabel(picklist.farm) : "Все производства"}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-ink-secondary">
                  Ecoculture-CRM
                </span>
              </div>
              <div className="flex items-baseline gap-x-4 gap-y-0.5 text-[12px] flex-wrap justify-end max-w-[62%]">
                <span className="font-semibold whitespace-nowrap">{picklist.dateLabel}</span>
                <span className="text-ink-secondary whitespace-nowrap">
                  заявок <b className="text-ink-primary">{picklist.totalOrders}</b>
                </span>
                <span className="text-ink-secondary whitespace-nowrap">
                  всего{" "}
                  <b className="text-ink-primary tabular-nums">
                    {picklist.totalStems.toLocaleString("ru-RU")}
                  </b>{" "}
                  шт.
                </span>
                {picklist.notReadyOrders > 0 && (
                  <span className="whitespace-nowrap text-status-critical">
                    <b>
                      ✗ не готовы: {picklist.notReadyOrders} на{" "}
                      {picklist.notReadyStems.toLocaleString("ru-RU")} шт.
                    </b>
                  </span>
                )}
                {picklist.shortageStems > 0 && (
                  <span className="whitespace-nowrap">
                    <b className="underline decoration-2 underline-offset-2">
                      не хватает {picklist.shortageStems.toLocaleString("ru-RU")}
                    </b>
                  </span>
                )}
              </div>
            </div>

            {/* Матрица: позиции × клиенты */}
            <table className="w-full text-[12px] mt-2 table-fixed">
              <colgroup>
                <col style={{ width: 20 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 60 }} />
                {clients.map((c) => (
                  <col key={c.orderId} style={vertical ? { width: 34 } : undefined} />
                ))}
                <col style={{ width: 56 }} />
                <col style={{ width: 52 }} />
                <col style={{ width: 44 }} />
              </colgroup>

              <thead>
                {/* Менеджеры: каждая группа накрывает колонки своих клиентов */}
                <tr className="align-bottom">
                  <th colSpan={3} className="pb-0.5 text-left text-[10px] uppercase tracking-wider text-ink-secondary">
                    Менеджер
                  </th>
                  {managerGroups.map((g) => (
                    <th
                      key={g.manager}
                      colSpan={g.count}
                      className="pb-0.5 px-1 border-b border-ink-primary/50 overflow-hidden"
                      title={g.manager}
                    >
                      <div className="text-center text-[10px] font-bold leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
                        {shortName(g.manager)}
                        <span className="text-ink-secondary font-normal tabular-nums">
                          {" "}
                          · {g.stems.toLocaleString("ru-RU")}
                        </span>
                      </div>
                    </th>
                  ))}
                  <th colSpan={3}></th>
                </tr>

                {/* Клиенты: имена вертикально — колонка остаётся узкой, имя читается целиком */}
                <tr className="align-bottom">
                  <th className="py-1 text-left font-semibold align-bottom">№</th>
                  <th className="py-1 text-left font-semibold align-bottom">Сорт</th>
                  <th className="py-1 text-left font-semibold align-bottom">Длина</th>
                  {clients.map((c) => (
                    <th key={c.orderId} className="px-0.5 align-bottom" title={c.clientName}>
                      <div
                        className={clsx(
                          "flex items-end justify-center overflow-hidden",
                          vertical ? "h-[108px]" : "h-auto"
                        )}
                      >
                        <span
                          className="whitespace-nowrap font-semibold text-[10px] leading-none"
                          style={
                            vertical
                              ? { writingMode: "vertical-rl", transform: "rotate(180deg)" }
                              : undefined
                          }
                        >
                          {c.clientName}
                        </span>
                      </div>
                    </th>
                  ))}
                  <th className="py-1 text-right font-bold align-bottom">ВСЕГО</th>
                  <th className="py-1 text-right font-semibold text-ink-secondary align-bottom">Склад</th>
                  <th className="py-1 text-center font-semibold align-bottom">Собр.</th>
                </tr>

                {/* Готовность: две галочки = менеджер согласовал и бухгалтер увидел оплату */}
                <tr className="border-b-2 border-ink-primary">
                  <th
                    colSpan={3}
                    className="pb-0.5 text-left text-[9px] uppercase tracking-wider text-ink-secondary font-semibold"
                  >
                    Готов к сборке
                  </th>
                  {clients.map((c) => (
                    <th
                      key={c.orderId}
                      className={clsx(
                        "pb-0.5 text-center text-[11px] leading-none font-bold",
                        c.readyToCollect ? "text-status-good" : "text-status-critical"
                      )}
                      title={
                        c.readyToCollect
                          ? "Согласовано менеджером и оплачено"
                          : [
                              c.managerConfirmed ? null : "менеджер не подтвердил",
                              c.paid ? null : "не оплачено",
                            ]
                              .filter(Boolean)
                              .join(", ")
                      }
                    >
                      {c.readyToCollect ? "✓✓" : "✗"}
                    </th>
                  ))}
                  <th colSpan={3}></th>
                </tr>
              </thead>

              <tbody>
                {byType.map((group) => (
                  <TypeRows
                    key={group.type}
                    type={group.type}
                    lines={group.lines}
                    clients={clients}
                  />
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-ink-primary font-bold">
                  <td colSpan={3} className="py-1.5">
                    ИТОГО ПО КЛИЕНТАМ
                  </td>
                  {clients.map((c) => (
                    <td key={c.orderId} className="py-1.5 text-center tabular-nums">
                      {c.totalStems.toLocaleString("ru-RU")}
                    </td>
                  ))}
                  <td className="py-1.5 text-right tabular-nums">
                    {picklist.totalStems.toLocaleString("ru-RU")}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>

            {/* Легенда клиентов: менеджер, телефон, комментарий */}
            <div className="mt-2 pt-1.5 border-t border-line-strong text-[10px] leading-snug pr-1">
              <div className="grid grid-cols-3 gap-x-5 gap-y-0.5 break-words">
                {clients.map((c) => (
                  <div key={c.orderId}>
                    <b>{c.clientName}</b>
                    <span className="text-ink-secondary">
                      {" "}
                      · {c.managerName}
                      {c.clientPhone && ` · ${c.clientPhone}`}
                    </span>
                    {c.notes && <span className="font-semibold"> — {c.notes}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Подписи */}
            <div className="grid grid-cols-3 gap-8 mt-3 text-[10px] text-ink-secondary">
              <SignField label="Собрал" />
              <SignField label="Время окончания" />
              <SignField label="Проверил" />
            </div>
          </div>
        </div>
      )}

      {picklist.ordersWithoutDate.length > 0 && (
        <section className="no-print">
          <h2 className="font-semibold mb-1">Заявки без даты доставки</h2>
          <p className="text-sm text-ink-secondary mb-2">
            Они не попадут ни в один дневной лист, пока менеджер не проставит дату.
          </p>
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {picklist.ordersWithoutDate.map((order) => (
                  <tr key={order.orderId} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2 font-medium">{order.clientName}</td>
                    <td className="px-4 py-2 text-ink-secondary">{order.managerName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {order.totalStems.toLocaleString("ru-RU")} шт.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/** Заголовок типа цветка и его строки. */
function TypeRows({
  type,
  lines,
  clients,
}: {
  type: string;
  lines: PicklistLine[];
  clients: PicklistOrder[];
}) {
  const typeTotal = lines.reduce((sum, l) => sum + Math.max(0, l.quantity - l.shipped), 0);

  return (
    <>
      <tr className="border-b border-ink-primary/40">
        <td colSpan={3} className="pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider">
          {FLOWER_TYPE_LABELS_PLURAL[type] ?? type}
        </td>
        <td colSpan={clients.length} className="pt-1.5 pb-0.5"></td>
        <td className="pt-1.5 pb-0.5 text-right text-[10px] font-bold tabular-nums">
          {typeTotal.toLocaleString("ru-RU")}
        </td>
        <td colSpan={2}></td>
      </tr>

      {lines.map((line, idx) => {
        const need = Math.max(0, line.quantity - line.shipped);
        const shortage = Math.max(0, need - line.available);
        return (
          <tr key={line.key} className="border-b border-line-hairline">
            <td className="py-[3px] text-ink-secondary tabular-nums text-[10px]">{idx + 1}</td>
            <td className="py-[3px] font-semibold truncate" title={line.variety}>
              {line.variety}
            </td>
            <td className="py-[3px] whitespace-nowrap">{formatGrade(line.grade)}</td>

            {clients.map((c) => {
              const qty = line.perOrder
                .filter((p) => p.orderId === c.orderId)
                .reduce((sum, p) => sum + p.quantity, 0);
              return (
                <td
                  key={c.orderId}
                  className={clsx(
                    "py-[3px] text-center tabular-nums",
                    qty > 0 ? "font-medium" : "text-ink-muted"
                  )}
                >
                  {qty > 0 ? qty.toLocaleString("ru-RU") : "·"}
                </td>
              );
            })}

            <td className="py-[3px] text-right font-bold tabular-nums">
              {need.toLocaleString("ru-RU")}
            </td>
            <td className="py-[3px] text-right tabular-nums text-ink-secondary">
              {shortage > 0 ? (
                <span className="font-bold text-ink-primary">
                  −{shortage.toLocaleString("ru-RU")}
                </span>
              ) : (
                line.available.toLocaleString("ru-RU")
              )}
            </td>
            <td className="py-[3px]">
              <div className="mx-auto w-[26px] h-[12px] border border-ink-muted rounded-[2px]" />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function SignField({ label }: { label: string }) {
  return (
    <div>
      <div className="h-[20px] border-b border-ink-secondary" />
      <div className="pt-0.5">{label}</div>
    </div>
  );
}
