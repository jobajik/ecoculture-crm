import clsx from "clsx";
import { FLOWER_TYPE_LABELS_PLURAL } from "@/lib/constants";
import { BENCHMARKS, toneLowerBetter, type Tone } from "@/lib/benchmarks";
import type { FlowerRow } from "@/lib/analytics";

/**
 * «По цветку» — первый блок аналитики.
 *
 * Владелец выбрал его сам: «она простая и понятная». И правда — это вся жизнь
 * хозяйства в трёх строках: сколько срезали, сколько продали, сколько списали и
 * что осталось лежать. Раньше таблица пряталась под кнопкой «Показать
 * подробности», то есть до самого понятного места надо было ещё докопаться.
 *
 * Компонент не клиентский: здесь нет ни состояния, ни кликов, а страница
 * аналитики серверная — значит и рисовать эту таблицу должен сервер, без
 * лишнего кода в браузере.
 *
 * Ноль показывается прочерком, а не нулём. «Продано 0» и «Списано —» в одной
 * строке означают одно и то же — что ничего не было, — и разнобой заставляет
 * глаз спотыкаться на пустом месте.
 */
export default function FlowerSummary({
  rows,
  days,
}: {
  rows: FlowerRow[];
  /** Длина окна — чтобы подпись не расходилась с расчётом. */
  days: number;
}) {
  if (rows.length === 0) return null;

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const num = (n: number) => (n > 0 ? nf(n) : "—");

  const totals = {
    received: rows.reduce((s, r) => s + r.received, 0),
    sold: rows.reduce((s, r) => s + r.sold, 0),
    writeoff: rows.reduce((s, r) => s + r.writeoff, 0),
    takeout: rows.reduce((s, r) => s + r.takeout, 0),
    transfer: rows.reduce((s, r) => s + r.transfer, 0),
    stock: rows.reduce((s, r) => s + r.stock, 0),
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
        <h2 className="font-medium">По цветку</h2>
        <span className="text-sm text-ink-muted">
          Что пришло, что ушло и что осталось за {days} дней
        </span>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[840px]">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">Цветок</th>
              <th className="px-3 py-2.5 font-medium text-right">Срезано</th>
              <th className="px-3 py-2.5 font-medium text-right">Продано</th>
              <th className="px-3 py-2.5 font-medium text-right">Списано</th>
              {/* Две колонки «ушло, но не продано». Без них строка не сходится:
                  стебли уехали со склада, а ни в продажах, ни в списаниях их
                  нет, и разница выглядит как ошибка в данных. */}
              <th className="px-3 py-2.5 font-medium text-right">В магазины и регионы</th>
              <th className="px-3 py-2.5 font-medium text-right">Сотрудникам</th>
              <th className="px-3 py-2.5 font-medium text-right">На складе</th>
              <th className="px-3 py-2.5 font-medium text-right">Запас</th>
              <th className="px-3 py-2.5 font-medium text-right">Ср. цена</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              // Запас сравнивается со сроком хранения этого цветка: «12 дней»
              // хорошо для хризантемы и плохо для розы.
              const ratio =
                f.coverDays !== null ? f.coverDays / Math.max(1, f.shelfLifeDays) : null;
              const tone: Tone =
                ratio === null ? "neutral" : toneLowerBetter(ratio, BENCHMARKS.coverRatio);
              return (
                <tr key={f.flowerType} className="border-b border-line-hairline">
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                    {FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(f.received)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(f.sold)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(f.writeoff)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(f.transfer)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(f.takeout)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {num(f.stock)}
                  </td>
                  <td
                    className={clsx(
                      "px-3 py-2.5 text-right tabular-nums whitespace-nowrap",
                      tone === "neutral" ? "" : TONE_TEXT[tone]
                    )}
                  >
                    {f.coverDays === null ? "—" : `${Math.round(f.coverDays)} дн.`}
                    <span className="block text-[11px] text-ink-muted">
                      срок {f.shelfLifeDays} {dayWord(f.shelfLifeDays)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {f.avgPrice.value > 0 ? `${nf(f.avgPrice.value)} ₸` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Итог по хозяйству: три строки складываются в уме плохо, а вопрос
              «сколько всего срезали» задают первым. */}
          <tfoot>
            <tr className="bg-surface-plane/60">
              <td className="px-4 py-2.5 font-medium">Всего</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {num(totals.received)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {num(totals.sold)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {num(totals.writeoff)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {num(totals.transfer)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {num(totals.takeout)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {num(totals.stock)}
              </td>
              <td colSpan={2} className="px-3 py-2.5 text-right text-xs text-ink-muted">
                стеблей
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Те же цвета статуса, что и в остальной аналитике. */
const TONE_TEXT: Record<Tone, string> = {
  good: "text-status-good",
  warning: "text-[#8a5a00]",
  critical: "text-status-critical",
  neutral: "text-ink-primary",
};

function dayWord(n: number): string {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return "дней";
  if (o === 1) return "день";
  if (o > 1 && o < 5) return "дня";
  return "дней";
}
