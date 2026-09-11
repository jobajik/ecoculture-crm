"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { saveManagerPlansAction } from "@/app/plans/actions";
import { periodLabel } from "@/lib/constants";
import { PLAN_FLOWERS, planCellKey, planFlowerLabel } from "@/lib/managerPlans";
import NumberCell from "./NumberCell";

export interface ManagerPlanEntry {
  email: string;
  name: string;
  /** План по каждому цветку: ключ — код цветка. Незаполненного в наборе нет. */
  byFlower: Record<string, { targetAmount: number; targetStems: number }>;
  /** Старое число «без разбивки»: показывается, пока цветки не заполнены. */
  legacyAmount: number;
  legacyStems: number;
  splitByFlower: boolean;
}

interface Cell {
  amount: number;
  stems: number;
}

/**
 * План продаж по менеджерам на месяц, разбитый по цветку.
 *
 * Цветок — ПЕРЕКЛЮЧАТЕЛЬ, а не шесть колонок сразу: шесть полей ввода в строке
 * не читаются на телефоне, а РОП ставит план и с телефона. Так же сделан план
 * отгрузок и страница регионов — переключатель у них один и тот же на вид.
 *
 * Правки по всем трём цветкам живут в ОДНОМ наборе черновиков: человек ставит
 * розы, переключается на хризантему, возвращается — и его цифры на месте.
 * Сохраняются тоже все сразу, одним действием: три отдельных сохранения
 * означали бы три шанса остановиться на середине.
 *
 * Отправляем только те ячейки, которые человек действительно изменил: незачем
 * переписывать чужие планы, к которым он не прикасался.
 */
export default function ManagerPlansForm({
  period,
  initial,
}: {
  period: string;
  initial: ManagerPlanEntry[];
}) {
  const router = useRouter();

  const initialCells = useMemo(() => toCells(initial), [initial]);
  const [cells, setCells] = useState<Record<string, Cell>>(initialCells);
  const [flower, setFlower] = useState<string>(PLAN_FLOWERS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // initial приходит с сервера. Когда меняется месяц, страница перерисовывается
  // с новыми данными — сбрасываем правки, иначе цифры прошлого месяца
  // «переедут» в новый.
  const [seenPeriod, setSeenPeriod] = useState(period);
  if (seenPeriod !== period) {
    setSeenPeriod(period);
    setCells(initialCells);
    setSaved(null);
    setError(null);
  }

  const cell = (email: string, flowerType: string): Cell =>
    cells[planCellKey(email, flowerType)] ?? { amount: 0, stems: 0 };

  const changed = useMemo(() => {
    const list: { email: string; flowerType: string; amount: number; stems: number }[] = [];
    for (const row of initial) {
      for (const f of PLAN_FLOWERS) {
        const key = planCellKey(row.email, f);
        const now = cells[key] ?? { amount: 0, stems: 0 };
        const was = initialCells[key] ?? { amount: 0, stems: 0 };
        if (now.amount !== was.amount || now.stems !== was.stems) {
          list.push({ email: row.email, flowerType: f, amount: now.amount, stems: now.stems });
        }
      }
    }
    return list;
  }, [cells, initial, initialCells]);

  /**
   * Итог по менеджеру — сумма его цветков, отдельным числом он не хранится.
   *
   * Пока цветки не заполнены, планом остаётся старое число (так же считает и
   * сервер). Показать в этой колонке ноль значило бы сказать человеку «плана
   * нет», хотя он стоит — и первым делом его вписали бы заново поверх.
   */
  const managerTotal = (row: ManagerPlanEntry): Cell & { legacy: boolean } => {
    const sum = PLAN_FLOWERS.reduce(
      (acc, f) => {
        const c = cell(row.email, f);
        return { amount: acc.amount + c.amount, stems: acc.stems + c.stems };
      },
      { amount: 0, stems: 0 }
    );
    const touched = sum.amount > 0 || sum.stems > 0;
    if (row.splitByFlower || touched) return { ...sum, legacy: false };
    return { amount: row.legacyAmount, stems: row.legacyStems, legacy: row.legacyAmount > 0 };
  };

  const flowerTotals = useMemo(() => {
    const totals: Record<string, Cell> = {};
    for (const f of PLAN_FLOWERS) {
      totals[f] = initial.reduce(
        (sum, row) => {
          const c = cells[planCellKey(row.email, f)] ?? { amount: 0, stems: 0 };
          return { amount: sum.amount + c.amount, stems: sum.stems + c.stems };
        },
        { amount: 0, stems: 0 }
      );
    }
    return totals;
  }, [cells, initial]);

  // План отдела — сумма планов менеджеров, а не сумма колонок по цветкам: у
  // того, кто ещё не разнесён, план стоит старым числом и в колонки не попадает.
  // Иначе итог здесь расходился бы с тем же итогом в разделе «Продажи».
  const grandTotal = initial.reduce(
    (sum, row) => {
      const total = managerTotal(row);
      return { amount: sum.amount + total.amount, stems: sum.stems + total.stems };
    },
    { amount: 0, stems: 0 }
  );

  // Те, у кого план прямо сейчас считается старым числом. Считаем через тот же
  // `managerTotal`, а не по флагу из базы: стоит человеку вписать цветок — и
  // строка перестаёт быть «неразнесённой» ещё до сохранения.
  const unsplit = initial.filter((row) => managerTotal(row).legacy);

  function update(email: string, patch: Partial<Cell>) {
    const key = planCellKey(email, flower);
    setCells((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { amount: 0, stems: 0 }), ...patch },
    }));
    setSaved(null);
  }

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveManagerPlansAction(
        period,
        changed.map((row) => ({
          period,
          managerEmail: row.email,
          flowerType: row.flowerType,
          targetAmount: row.amount,
          targetStems: row.stems,
        }))
      );
      setSaved(`Сохранено строк плана: ${changed.length}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (initial.length === 0) {
    return (
      <div className="card text-sm text-ink-secondary">
        В системе пока нет ни одного активного менеджера. Менеджеры заводятся на вкладке{" "}
        <b>Users</b> Google-таблицы — как только там появится строка с ролью <code>manager</code>,
        она появится и здесь.
      </div>
    );
  }

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <div className="space-y-3">
      {/* Переключатель цветка. На кнопке сразу стоит итог по нему — иначе, чтобы
          увидеть весь план, пришлось бы три раза переключиться и держать цифры
          в голове. */}
      <div className="flex flex-wrap gap-2">
        {PLAN_FLOWERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFlower(f)}
            className={clsx(
              "rounded-lg border px-3 py-2 text-left transition-colors",
              f === flower
                ? "border-accent bg-accent/10 text-accent"
                : "border-line-hairline text-ink-secondary hover:bg-surface-plane"
            )}
          >
            <div className="text-sm font-medium">{planFlowerLabel(f)}</div>
            <div className="text-xs tabular-nums opacity-80">
              {nf(flowerTotals[f].amount)} ₸ · {nf(flowerTotals[f].stems)} шт
            </div>
          </button>
        ))}
      </div>

      {/* На узком экране таблица не сжимается, а прокручивается вбок: у поля
          ввода есть предел, за которым «1 800 000» показывается как «1 800 0».
          Шрифт уменьшить нельзя — при меньшем 16 px Safari на iPhone сам
          увеличивает страницу, как только палец попадает в поле. */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full min-w-[540px] sm:min-w-0 text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Менеджер</th>
              <th className="px-4 py-3 font-medium w-40">
                План продаж
                <div className="text-xs font-normal text-ink-muted">
                  {planFlowerLabel(flower).toLowerCase()}
                </div>
              </th>
              <th className="px-4 py-3 font-medium w-40">
                План стеблей
                <div className="text-xs font-normal text-ink-muted">
                  {planFlowerLabel(flower).toLowerCase()}
                </div>
              </th>
              {/* На телефоне четвёртая колонка не влезает: поля ввода сжимаются
                  так, что числа в них обрезаются. Там итог показан строкой под
                  фамилией. */}
              <th className="px-4 py-3 font-medium text-right hidden sm:table-cell">
                Всего за месяц
                <div className="text-xs font-normal text-ink-muted">все цветки</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {initial.map((row) => {
              const current = cell(row.email, flower);
              const total = managerTotal(row);
              return (
                <tr key={row.email} className="border-b border-line-hairline last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium">{row.name || row.email}</div>
                    <div className="text-xs text-ink-muted hidden sm:block">{row.email}</div>
                    <div className="text-xs text-ink-secondary sm:hidden tabular-nums">
                      всего за месяц: {nf(total.amount)} ₸
                    </div>
                    {total.legacy && (
                      <div className="text-xs text-status-warning mt-0.5">
                        план стоит старым числом, без разбивки по цветку
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <NumberCell
                      value={current.amount}
                      onChange={(v) => update(row.email, { amount: v })}
                      disabled={saving}
                      suffix="₸"
                      ariaLabel={`План продаж, ${planFlowerLabel(flower)}, ${row.name || row.email}`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <NumberCell
                      value={current.stems}
                      onChange={(v) => update(row.email, { stems: v })}
                      disabled={saving}
                      suffix="шт"
                      ariaLabel={`План стеблей, ${planFlowerLabel(flower)}, ${row.name || row.email}`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums hidden sm:table-cell">
                    <div className={clsx("font-medium", total.legacy && "text-status-warning")}>
                      {nf(total.amount)} ₸
                    </div>
                    <div className="text-xs text-ink-muted">
                      {total.legacy ? "старым числом" : `${nf(total.stems)} шт`}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane">
              <td className="px-4 py-3 font-medium">
                Итого по отделу
                <div className="text-xs font-normal text-ink-muted">
                  в колонках — {planFlowerLabel(flower).toLowerCase()}
                </div>
                <div className="text-xs font-normal text-ink-secondary sm:hidden tabular-nums">
                  всего за месяц: {nf(grandTotal.amount)} ₸
                </div>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {nf(flowerTotals[flower].amount)} ₸
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {nf(flowerTotals[flower].stems)} шт
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums hidden sm:table-cell">
                <div>{nf(grandTotal.amount)} ₸</div>
                <div className="text-xs font-normal text-ink-muted">{nf(grandTotal.stems)} шт</div>
                {unsplit.length > 0 && (
                  <div className="text-xs font-normal text-status-warning">
                    в том числе {nf(unsplit.reduce((s, r) => s + r.legacyAmount, 0))} ₸ старым числом
                  </div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {unsplit.length > 0 && (
        <div className="text-sm text-ink-secondary bg-status-warning/10 rounded-lg px-3 py-2">
          У {unsplit.length === 1 ? "одного менеджера" : `${unsplit.length} менеджеров`} план стоит
          старым числом, без разбивки по цветку — он и считается планом, пока цветки не заполнены.
          Как только вы впишете хотя бы один цветок, планом станет сумма цветков, а старое число
          обнулится.
        </div>
      )}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{saved}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || changed.length === 0}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : `Сохранить план на ${periodLabel(period)}`}
        </button>
        <span className="text-sm text-ink-muted">
          {changed.length === 0
            ? "Изменений нет"
            : `Изменено ячеек: ${changed.length}${changedFlowersLabel(changed)}`}
        </span>
      </div>
    </div>
  );
}

function toCells(entries: ManagerPlanEntry[]): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const row of entries) {
    for (const f of PLAN_FLOWERS) {
      const plan = row.byFlower[f];
      cells[planCellKey(row.email, f)] = {
        amount: plan?.targetAmount ?? 0,
        stems: plan?.targetStems ?? 0,
      };
    }
  }
  return cells;
}

/**
 * Какие цветки затронуты правкой. Нужно потому, что цветок переключается:
 * человек правил хризантему, ушёл на розы и уже не видит, что у него не
 * сохранено — а подпись у кнопки одна на всю форму.
 */
function changedFlowersLabel(
  changed: { flowerType: string }[]
): string {
  const flowers = PLAN_FLOWERS.filter((f) => changed.some((c) => c.flowerType === f));
  if (flowers.length === 0) return "";
  return ` (${flowers.map((f) => planFlowerLabel(f).toLowerCase()).join(", ")})`;
}
