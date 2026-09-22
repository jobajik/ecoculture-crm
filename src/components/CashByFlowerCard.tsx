import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { CashByFlower } from "@/lib/cashByFlower";
import Hint from "./Hint";

/**
 * Касса по цветкам.
 *
 * Владелец прислал снимок страницы своей тетради — «касса: хриз. 20 000, роза
 * 30 000» — и попросил то же самое в программе. То, что он ведёт это на бумаге,
 * и есть главный довод: «Получено» стояло одним числом и на его вопрос не
 * отвечало.
 *
 * Вид намеренно как в тетради: название цветка и сумма, ничего больше. Доли,
 * проценты и сравнения с прошлым месяцем здесь лишние — это не отчёт, а касса.
 *
 * **Про день сказано прямо в подписи, и это важно.** Все остальные цифры на
 * странице считаются по дню ОФОРМЛЕНИЯ заявки, а касса — по дню, когда деньги
 * ПРИШЛИ. Расхождение осознанное (так решил владелец), но человек, увидевший
 * два разных числа, первым делом ищет ошибку. Поэтому объяснение стоит рядом, а
 * не в документации.
 *
 * Компонент не клиентский: состояния в нём нет, а страница серверная — значит и
 * рисует его сервер. Тот же приём, что у таблицы «По цветку» в аналитике.
 */
export default function CashByFlowerCard({
  cash,
  periodLabel,
}: {
  cash: CashByFlower;
  periodLabel: string;
}) {
  const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;
  const rows = cash.rows.filter((r) => r.amount > 0);

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="font-medium">
          Касса по цветкам
          <Hint>
            Считается по дню, когда пришли деньги, поэтому может не совпадать с остальными цифрами
            страницы (они — по дню оформления). Смешанный платёж делится по сумме позиций.
          </Hint>
        </h3>
        <span className="text-xs text-ink-muted">{periodLabel}</span>
      </div>

      {rows.length === 0 && cash.unsplit === 0 ? (
        <p className="text-sm text-ink-secondary">Денег не поступало.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.flowerType} className="border-b border-line-hairline last:border-0">
                <td className="py-2">{FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType}</td>
                <td className="py-2 text-right tabular-nums font-medium">{money(row.amount)}</td>
              </tr>
            ))}
            {/* Деньги без позиций — заявка, у которой нечего делить. Молчать
                о них нельзя: итог кассы иначе не сошёлся бы с суммой строк, и
                разницу пришлось бы искать глазами. */}
            {cash.unsplit > 0 && (
              <tr className="border-b border-line-hairline">
                <td className="py-2 text-ink-secondary">Без разбивки (в заявке нет позиций)</td>
                <td className="py-2 text-right tabular-nums">{money(cash.unsplit)}</td>
              </tr>
            )}
            <tr>
              <td className="pt-2 font-medium">Всего в кассу</td>
              <td className="pt-2 text-right tabular-nums font-semibold text-status-good">
                {money(cash.total)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
