"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { moveStockAction, previewMoveAction } from "@/app/office/actions";
import { unwrapValue } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import { positionKey, positionLabel, type StockPosition, type WriteoffPlan } from "@/lib/writeoffPlan";
import type { MoveDirection, MoveLine } from "@/lib/officeStore";

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

  const positions = direction === "to_office" ? main : office;
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const flowers = Array.from(new Set(positions.map((p) => p.flowerType)));
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions
      .filter((p) => !flower || p.flowerType === flower)
      .filter((p) => !q || positionLabel(p).toLowerCase().includes(q));
  }, [positions, flower, search]);

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

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-line-hairline p-1 bg-surface-plane" role="tablist">
        {(
          [
            ["to_office", "Склад → Офис"],
            ["to_main", "Офис → Склад"],
          ] as const
        ).map(([d, label]) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={direction === d}
            onClick={() => switchDirection(d)}
            className={clsx("px-3 py-1.5 rounded-md text-sm", direction === d ? "bg-surface shadow-sm font-medium" : "text-ink-secondary")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card !p-0">
        <div className="p-4 flex flex-wrap items-end gap-3 border-b border-line-hairline">
          <select className="input !w-44" value={flower} onChange={(e) => setFlower(e.target.value)}>
            <option value="">Все цветы</option>
            {flowers.map((f) => (
              <option key={f} value={f}>
                {FLOWER_TYPE_LABELS[f] ?? f}
              </option>
            ))}
          </select>
          <input className="input !w-56" placeholder="Найти сорт…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="table-scroll table-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2.5 font-medium">Позиция</th>
                <th className="px-3 py-2.5 font-medium text-right">{direction === "to_office" ? "На складе" : "В офисе"}</th>
                <th className="px-3 py-2.5 font-medium text-right">Переместить, шт</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const k = positionKey(p);
                const v = Number(qty[k]) || 0;
                return (
                  <tr key={k} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2">{positionLabel(p)}</td>
                    <td data-label="Есть" className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                      {nf(p.stock)}
                    </td>
                    <td data-label="Переместить, шт" className="px-3 py-2 text-right">
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
                  <td colSpan={3} className="px-4 py-8 text-center text-ink-muted">
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
      </div>

      <div className="card space-y-3">
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
          <div className="border border-line-hairline rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {plan.lines.map((l, i) => (
                  <tr key={i} className="border-b border-line-hairline last:border-0 align-top">
                    <td className="px-3 py-2">{positionLabel(l)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{nf(l.quantity)} шт.</td>
                    <td className="px-3 py-2 text-xs">
                      {plan.result.errors[i] ? (
                        <span className="text-status-critical">{plan.result.errors[i]}</span>
                      ) : (
                        <span className="text-ink-muted">
                          {plan.result.byLine[i].map((b) => `${nf(b.quantity)} из срезки ${formatDay(b.harvestDate)}`).join(", ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
        {done && <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{done}</div>}

        <div className="flex flex-wrap items-center gap-3">
          {!planOk ? (
            <button type="button" className="btn-primary" disabled={busy || lines.length === 0} onClick={check}>
              {busy ? "Проверяю…" : `Проверить${total > 0 ? ` · ${nf(total)} шт.` : ""}`}
            </button>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={busy} onClick={apply}>
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
