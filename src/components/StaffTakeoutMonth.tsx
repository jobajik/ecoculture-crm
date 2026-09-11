import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import { formatDay } from "@/lib/formatDate";
import type { StaffMonth } from "@/lib/staffTakeout";

/**
 * Итог за месяц по сотрудникам — сколько взял и на какую сумму.
 *
 * Это ответ на «вести учёт именно по сотрудникам»: строка на человека, а не на
 * каждый букет. Сортировка по сумме, а не по алфавиту: разговор начинается с
 * того, у кого набежало больше всех.
 *
 * Компонент один на две страницы — склад и оплаты. Таблица одна и та же, а
 * второй копией они разошлись бы: на складе поправили бы разбивку по цветку,
 * у бухгалтера осталась бы старая, и два отчёта о тех же деньгах стали бы
 * расходиться между собой.
 *
 * Компонент не клиентский: состояния в нём нет, а страницы серверные.
 */
export default function StaffTakeoutMonth({
  month,
  title,
  hint,
}: {
  month: StaffMonth;
  title: string;
  hint: string;
}) {
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
        <h2 className="font-medium">{title}</h2>
        <span className="text-sm text-ink-muted">{hint}</span>
      </div>

      {month.rows.length === 0 ? (
        <div className="card text-sm text-ink-secondary">
          В этом месяце цветы в счёт зарплаты никто не брал.
        </div>
      ) : (
        <>
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-2.5 font-medium">Сотрудник</th>
                  <th className="px-3 py-2.5 font-medium">Что брал</th>
                  <th className="px-3 py-2.5 font-medium text-right">Стеблей</th>
                  <th className="px-3 py-2.5 font-medium text-right">Раз</th>
                  <th className="px-3 py-2.5 font-medium">Последний раз</th>
                  <th className="px-3 py-2.5 font-medium text-right">К удержанию</th>
                </tr>
              </thead>
              <tbody>
                {month.rows.map((r) => (
                  <tr key={r.key} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.staffName}</td>
                    <td className="px-3 py-2.5 text-ink-secondary">
                      {/* «Роза 60» читалось бы как длина стебля — а это
                          количество. Поэтому «шт.» здесь обязательно. */}
                      {r.byFlower
                        .map(
                          (f) =>
                            `${FLOWER_TYPE_LABELS[f.flowerType] ?? f.flowerType} — ${nf(
                              f.stems
                            )} шт.`
                        )
                        .join(", ")}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{nf(r.stems)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                      {r.takeouts}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">
                      {formatDay(r.lastDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {nf(r.amount)} ₸
                      {r.noPrice > 0 && (
                        <span className="block text-[11px] text-[#8a5a00]">
                          {r.noPrice} {rowWord(r.noPrice)} без цены
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-plane/60">
                  <td className="px-4 py-2.5 font-medium">Всего</td>
                  <td className="px-3 py-2.5 text-ink-muted text-xs">
                    {month.people} чел.
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {nf(month.stems)}
                  </td>
                  <td colSpan={2} />
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {nf(month.amount)} ₸
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {month.noPrice > 0 && (
            <p className="text-xs text-[#8a5a00] mt-2">
              {month.noPrice === 1 ? "В одной строке" : `В ${month.noPrice} строках`} не указана
              цена — стебли со склада ушли, а в сумму к удержанию они не попали. Цену вписывает
              зав. складом при записи выдачи.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Русское склонение: 1 строка, 2 строки, 5 строк. */
function rowWord(n: number): string {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return "строк";
  if (o === 1) return "строка";
  if (o > 1 && o < 5) return "строки";
  return "строк";
}
