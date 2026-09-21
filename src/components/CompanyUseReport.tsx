import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { formatDay } from "@/lib/formatDate";
import type { CompanyUsePeriod } from "@/lib/staffTakeout";

/**
 * Расход на нужды компании за месяц: сколько ушло, на что и чего.
 *
 * Один компонент на две страницы — склада (где расход записывают) и
 * бухгалтера (где его только смотрят): две копии таблицы разъехались бы.
 * Состояния нет, поэтому это серверный компонент.
 */
export default function CompanyUseReport({
  data,
  title,
}: {
  data: CompanyUsePeriod;
  title: string;
}) {
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
        <h2 className="font-medium">{title}</h2>
        <span className="text-sm text-ink-muted">
          {nf(data.stems)} шт.
          {data.amount > 0 && ` · по внутренней цене ${nf(data.amount)} ₸`}
          {data.noPrice > 0 && ` · без цены строк: ${data.noPrice}`}
        </span>
      </div>

      {data.byPurpose.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {data.byPurpose.map((p) => (
            <span
              key={p.purpose}
              className="text-sm rounded-lg border border-line-hairline px-2.5 py-1 text-ink-secondary"
            >
              {p.purpose} — <span className="tabular-nums text-ink-primary">{nf(p.stems)} шт.</span>
            </span>
          ))}
        </div>
      )}

      <div className="card !p-0 table-scroll table-cards mb-6">
        <table className="w-full text-sm min-w-[620px]">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">На что</th>
              <th className="px-3 py-2.5 font-medium">Дата</th>
              <th className="px-3 py-2.5 font-medium">Что</th>
              <th className="px-3 py-2.5 font-medium text-right">Стеблей</th>
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
              <th className="px-3 py-2.5 font-medium">Примечание</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.takeoutId} className="border-b border-line-hairline last:border-0">
                <td data-label="На что" className="px-4 py-2.5 font-medium">{r.purpose}</td>
                <td data-label="Дата" className="px-3 py-2.5 text-ink-secondary whitespace-nowrap">
                  {formatDay(r.date)}
                </td>
                <td data-label="Что" className="px-3 py-2.5 text-ink-secondary">
                  {FLOWER_TYPE_LABELS[r.flowerType] ?? r.flowerType} {r.variety} · {formatGrade(r.grade)}
                </td>
                <td data-label="Стеблей" className="px-3 py-2.5 text-right tabular-nums">{nf(r.quantity)}</td>
                <td data-label="Сумма" className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                  {r.unitPrice > 0 ? `${nf(r.amount)} ₸` : "—"}
                </td>
                <td data-label="Примечание" className="px-3 py-2.5 text-ink-muted">{r.note || "—"}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                  За этот месяц расхода на нужды компании не записано.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
