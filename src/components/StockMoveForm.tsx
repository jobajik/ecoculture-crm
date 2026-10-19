"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { moveStockAction, previewMoveAction } from "@/app/office/actions";
import { unwrapValue } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import { positionKey, positionLabel, type StockPosition, type WriteoffPlan } from "@/lib/writeoffPlan";
import type { MoveDirection, MoveLine } from "@/lib/officeStore";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";

/**
 * Перемещение основной склад ⇄ офис (РОП). Вписал количество напротив позиции →
 * «Проверить»: сервер раскладывает по партиям от старых срезок к свежим →
 * «Переместить». До второго нажатия ничего не пишется.
 */
export default function StockMoveForm({ main, office }: { main: StockPosition[]; office: StockPosition[] }) {
  const router = useRouter();
  const [direction, setDirection] = useState<MoveDirection>("to_office");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [flower, setFlower] = useState("");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<{ lines: MoveLine[]; result: WriteoffPlan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const positions = direction === "to_office" ? main : office;
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const flowers = Array.from(new Set(positions.map((p) => p.flowerType)));
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions
      .filter((p) => !flower || p.flowerType === flower)
      .filter((p) => !q || positionLabel(p).toLowerCase().includes(q));
  }, [positions, flower, search]);
  useEffect(() => setPage(0), [direction, flower, search]);

  const lines: MoveLine[] = positions
    .filter((p) => Number(qty[positionKey(p)]) > 0)
    .map((p) => ({ flowerType: p.flowerType, variety: p.variety, grade: p.grade, quantity: Number(qty[positionKey(p)]) }));
  const total = lines.reduce((s, l) => s + l.quantity, 0);

  function switchDirection(next: MoveDirection) {
    setDirection(next);
    setQty({});
    setPlan(null);
    setError(null);
    setDone(null);
    setFlower("");
  }

  async function check() {
    setError(null);
    setDone(null);
    if (lines.length === 0) return setError("Впишите, сколько переместить, хотя бы в одну строку");
    setBusy(true);
    try {
      setPlan({ lines, result: unwrapValue(await previewMoveAction(direction, lines)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setError(null);
    setBusy(true);
    try {
      const r = unwrapValue(await moveStockAction(direction, plan.lines, note));
      setDone(direction === "to_office" ? `В офис перемещено ${nf(r.total)} шт.` : `На основной склад вернули ${nf(r.total)} шт.`);
      setPlan(null);
      setQty({});
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось переместить");
    } finally {
      setBusy(false);
    }
  }

  const planOk = plan && !plan.result.errors.some(Boolean);

  // Новый вид (19.10.2026): форма живёт вкладкой внутри карточки «Офис» — слева позиции с отбором и страницами,
  // справа примечание, раскладка по партиям и кнопка. Без вложенных карточек.
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
          <Chips
            value={direction}
            onChange={(v) => switchDirection(v as MoveDirection)}
            items={[
              { value: "to_office", label: "Склад → Офис", count: main.length },
              { value: "to_main", label: "Офис → Склад", count: office.length },
            ]}
          />
          <div className="flex gap-2 xl:ml-auto min-w-0">
            {flowers.length > 1 && (
              <select className="input !w-36" value={flower} onChange={(e) => setFlower(e.target.value)}>
                <option value="">Все цветы</option>
                {flowers.map((f) => (
                  <option key={f} value={f}>
                    {FLOWER_TYPE_LABELS[f] ?? f}
                  </option>
                ))}
              </select>
            )}
            <input className="input !w-auto xl:w-[200px] min-w-0 flex-1" placeholder="Найти сорт…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-scroll table-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className="px-4 py-2.5 font-medium">Позиция</th>
                <th className="px-3 py-2.5 font-medium text-right">{direction === "to_office" ? "На складе" : "В офисе"}</th>
                <th className="px-4 py-2.5 font-medium text-right">Переместить, шт</th>
              </tr>
            </thead>
            <tbody>
              {pageSlice(visible, page).map((p) => {
                const k = positionKey(p);
                const v = Number(qty[k]) || 0;
                return (
                  <tr key={k} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                    <td className="px-4 py-2">{positionLabel(p)}</td>
                    <td data-label="Есть" className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                      {nf(p.stock)}
                    </td>
                    <td data-label="Переместить, шт" className="px-4 py-2 text-right">
                      <input
                        className={clsx("input !w-28 text-right", v > p.stock && "!border-status-critical")}
                        inputMode="numeric"
                        value={qty[k] ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          setPlan(null);
                          setQty({ ...qty, [k]: e.target.value.replace(/[^\d]/g, "") });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-ink-muted">
                    {positions.length === 0
                      ? direction === "to_office"
                        ? "На основном складе ничего нет."
                        : "В офисе ничего нет."
                      : "Ничего не нашлось."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager total={visible.length} page={page} onPage={setPage} what="позиций" />
      </div>

      <div className="space-y-3 px-4 sm:px-5 py-4 border-t lg:border-t-0 lg:border-l border-line-hairline">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-[15px] font-bold">{direction === "to_office" ? "В офис" : "Обратно на склад"}</h3>
          <span className="text-sm text-ink-secondary tabular-nums">
            {lines.length > 0 ? `${lines.length} поз. · ${nf(total)} шт.` : "ничего не вписано"}
          </span>
        </div>
        <label className="text-sm block">
          <span className="label">Примечание</span>
          <input
            className="input"
            value={note}
            placeholder="на вечерние заказы"
            onChange={(e) => {
              setPlan(null);
              setNote(e.target.value);
            }}
          />
        </label>

        {plan && (
          <ul className="border border-line-hairline rounded-lg divide-y divide-line-hairline text-sm max-h-[45vh] overflow-y-auto">
            {plan.lines.map((l, i) => (
              <li key={i} className="px-3 py-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0">{positionLabel(l)}</span>
                  <span className="tabular-nums whitespace-nowrap font-medium">{nf(l.quantity)} шт.</span>
                </div>
                <div className="text-xs mt-0.5">
                  {plan.result.errors[i] ? (
                    <span className="text-status-critical">{plan.result.errors[i]}</span>
                  ) : (
                    <span className="text-ink-muted">
                      {plan.result.byLine[i].map((b) => `${nf(b.quantity)} из срезки ${formatDay(b.harvestDate)}`).join(", ")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
        {done && <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{done}</div>}

        <div className="flex flex-wrap items-center gap-3">
          {!planOk ? (
            <button type="button" className="btn-primary flex-1" disabled={busy || lines.length === 0} onClick={check}>
              {busy ? "Проверяю…" : `Проверить${total > 0 ? ` · ${nf(total)} шт.` : ""}`}
            </button>
          ) : (
            <>
              <button type="button" className="btn-primary flex-1" disabled={busy} onClick={apply}>
                {busy ? "Перемещаю…" : direction === "to_office" ? `Переместить в офис ${nf(plan!.result.total)} шт.` : `Вернуть на склад ${nf(plan!.result.total)} шт.`}
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPlan(null)}>
                Поправить
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-ink-muted">Берётся с самых старых срезок. Не сходится хоть одна строка — не переместится ничего.</p>
      </div>
    </div>
  );
}
