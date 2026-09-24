import clsx from "clsx";
import { FLOWER_TYPES_BY_FARM, FLOWER_TYPE_LABELS_PLURAL, farmLabel } from "@/lib/constants";
import { decimal, percent, shortMoney } from "@/lib/formatNumber";
import type { StockCompanyRow } from "@/lib/stock";
import Hint from "./Hint";

// Главная, под сводкой склада: «сколько это стоит, что из этого ходовое, на
// сколько хватит» и то же по каждой компании. Состояния нет — рисуется и
// сервером, и внутри StockBoard (он клиентский и обновляется сам).

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");

function plural(v: number, one: string, few: string, many: string) {
  const t = Math.abs(v) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return many;
  if (o > 1 && o < 5) return few;
  if (o === 1) return one;
  return many;
}
/** «24,8 дня», «7 дней»: дробное число по-русски всегда «дня». */
export function daysText(v: number): string {
  const text = decimal(v);
  return `${text} ${text.includes(",") ? "дня" : plural(Math.round(v), "день", "дня", "дней")}`;
}
const days = daysText;
/** Запас — целыми днями: «6,2 дня» точнее, чем данные, по которым он посчитан. */
const coverText = (v: number) => {
  const d = Math.round(v);
  return d < 1 ? "меньше дня" : `≈ ${d} ${plural(d, "день", "дня", "дней")}`;
};

/** Четыре цифры по всему видимому складу. */
export function StockPulse({ row }: { row: StockCompanyRow }) {
  if (row.stems === 0 && row.received7 === 0 && !row.shipped7) return null;
  const cells: { label: string; value: string; sub?: string; tone?: string }[] = [];
  if (row.value !== null) {
    cells.push({
      label: "По прайсу",
      value: `≈ ${shortMoney(row.value)}`,
      sub:
        row.criticalValue && row.criticalValue > 0
          ? `просрочено на ${shortMoney(row.criticalValue)}`
          : row.unpricedStems > 0
            ? `${n(row.unpricedStems)} шт. без цены`
            : "всё в сроке",
      tone: row.criticalValue && row.criticalValue > 0 ? "text-status-critical" : undefined,
    });
  }
  if (row.liquidPercent !== null) {
    cells.push({ label: "Ходовое", value: percent(row.liquidPercent, 0), sub: "ликвидные длины и категории" });
  }
  if (row.shipped7 !== null) {
    cells.push({
      label: "Хватит на",
      value: row.coverDays !== null ? coverText(row.coverDays) : "—",
      sub: row.coverDays !== null ? "при отгрузках недели" : "за неделю не отгружали",
    });
    cells.push({
      label: "За 7 дней",
      value: `+${n(row.received7)} / −${n(row.shipped7)}`,
      sub: "пришло / отгружено, шт.",
    });
  }
  if (cells.length === 0) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="card !p-3 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">{c.label}</div>
          <div className="text-lg font-semibold tabular-nums leading-tight truncate">{c.value}</div>
          {c.sub && <div className={clsx("text-xs truncate", c.tone ?? "text-ink-muted")}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Карточка на компанию. Показывается, только когда компаний больше одной. */
export function StockCompanies({ companies, total }: { companies: StockCompanyRow[]; total: number }) {
  if (companies.length < 2) return null;
  return (
    <div>
      <h3 className="font-medium mb-2">
        По компаниям
        <Hint>
          Стоимость — по клиентскому прайсу на сегодня. «Хватит на» — непросроченный остаток,
          делённый на отгрузки последних 7 дней.
        </Hint>
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        {companies.map((c) => (
          <CompanyCard key={c.farm} row={c} total={total} />
        ))}
      </div>
    </div>
  );
}

function CompanyCard({ row, total }: { row: StockCompanyRow; total: number }) {
  const ok = Math.max(0, row.stems - row.warningStems - row.criticalStems);
  const share = total > 0 ? (row.stems / total) * 100 : 0;
  const pct = (v: number) => (row.stems > 0 ? `${(v / row.stems) * 100}%` : "0%");
  const lines: { label: string; value: string; tone?: string }[] = [
    { label: "Средний возраст", value: row.stems > 0 ? days(row.avgAgeDays) : "—" },
  ];
  if (row.value !== null) {
    lines.push({ label: "По прайсу", value: `≈ ${shortMoney(row.value)}` });
    if (row.criticalValue) {
      lines.push({ label: "из них просрочено", value: shortMoney(row.criticalValue), tone: "text-status-critical" });
    }
  }
  if (row.liquidPercent !== null) lines.push({ label: "Ходовое", value: percent(row.liquidPercent, 0) });
  if (row.shipped7 !== null) {
    lines.push({ label: "За 7 дней пришло", value: `${n(row.received7)} шт.` });
    lines.push({ label: "За 7 дней отгружено", value: `${n(row.shipped7)} шт.` });
    lines.push({ label: "Хватит на", value: row.coverDays !== null ? coverText(row.coverDays) : "—" });
  }

  return (
    <div className="card !p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-3 pb-2 mb-3 border-b border-line-hairline">
        <div className="min-w-0">
          <h4 className="font-semibold truncate">{farmLabel(row.farm)}</h4>
          <div className="text-[11px] text-ink-muted truncate">
            {(FLOWER_TYPES_BY_FARM[row.farm] ?? []).map((t) => FLOWER_TYPE_LABELS_PLURAL[t] ?? t).join(", ")}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-semibold tabular-nums leading-none">{n(row.stems)}</div>
          <div className="text-[11px] text-ink-muted">шт. · {percent(share, 0)} склада</div>
        </div>
      </div>

      {row.stems > 0 && (
        <div className="mb-3">
          <div className="flex h-2 rounded-full overflow-hidden bg-surface-sunk" aria-hidden>
            <div className="bg-status-good" style={{ width: pct(ok) }} />
            <div className="bg-status-warning" style={{ width: pct(row.warningStems) }} />
            <div className="bg-status-critical" style={{ width: pct(row.criticalStems) }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs">
            <span className="text-status-good">в сроке {n(ok)}</span>
            {row.warningStems > 0 && <span className="text-[#8a5a00]">скоро истекут {n(row.warningStems)}</span>}
            {row.criticalStems > 0 && <span className="text-status-critical">просрочено {n(row.criticalStems)}</span>}
          </div>
        </div>
      )}

      <dl className="text-sm space-y-1">
        {lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-secondary">{l.label}</dt>
            <dd className={clsx("tabular-nums font-medium text-right", l.tone)}>{l.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
