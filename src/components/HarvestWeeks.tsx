import clsx from "clsx";

/**
 * «Хватит ли срезки на план отгрузок» — картинкой по неделям.
 *
 * Раньше вкладка «Баланс» открывалась переключателями цветка и недели и тремя
 * карточками про ОДНУ неделю ОДНОГО цветка: чтобы увидеть месяц, надо было
 * прощёлкать пятнадцать комбинаций. Здесь весь месяц виден сразу: цветок —
 * строка, неделя — плитка с двумя полосками (срезка и план в одном масштабе) и
 * словом «остаток» / «не хватит». Распределение по направлениям осталось, но
 * ниже, под кнопкой: оно нужно, когда уже понятно, где не сходится.
 *
 * Без состояния — рисуется на сервере.
 */

export interface HarvestWeekTile {
  code: string;
  index: number;
  label: string;
  forecast: number;
  planned: number;
  /** Сколько из прогноза — высшая категория. */
  top: number;
}

export interface HarvestFlowerRow {
  flowerType: string;
  label: string;
  weeks: HarvestWeekTile[];
}

/** До этого расхождения неделя считается сошедшейся: прогноз есть прогноз. */
export const MATCH_TOLERANCE = 0.03;

export function weekState(forecast: number, planned: number): "empty" | "noForecast" | "noPlan" | "match" | "surplus" | "short" {
  if (forecast <= 0 && planned <= 0) return "empty";
  if (forecast <= 0) return "noForecast";
  if (planned <= 0) return "noPlan";
  const diff = forecast - planned;
  if (Math.abs(diff) <= forecast * MATCH_TOLERANCE) return "match";
  return diff > 0 ? "surplus" : "short";
}

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

function stateText(forecast: number, planned: number): { text: string; tone: string } {
  const diff = forecast - planned;
  switch (weekState(forecast, planned)) {
    case "empty":
      return { text: "пусто", tone: "text-ink-muted" };
    case "noForecast":
      return { text: "нет прогноза", tone: "text-ink-muted" };
    case "noPlan":
      return { text: `без плана ${nf(forecast)}`, tone: "text-[#8a5a00]" };
    case "match":
      return { text: "сходится", tone: "text-accent" };
    case "surplus":
      return { text: `остаток +${nf(diff)}`, tone: "text-[#8a5a00]" };
    case "short":
      return { text: `не хватит ${nf(-diff)}`, tone: "text-status-critical" };
  }
}

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-surface-sunk">
      <div className={clsx("h-full rounded-full", className)} style={{ width: `${width}%` }} />
    </div>
  );
}

export default function HarvestWeeks({ rows, currentWeek }: { rows: HarvestFlowerRow[]; currentWeek?: string }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-full bg-accent" /> срезка (прогноз агронома)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-full bg-ink-secondary/70" /> план отгрузок
        </span>
      </div>

      {rows.map((row) => {
        const forecast = row.weeks.reduce((s, w) => s + w.forecast, 0);
        const planned = row.weeks.reduce((s, w) => s + w.planned, 0);
        const top = row.weeks.reduce((s, w) => s + w.top, 0);
        // Один масштаб на весь цветок: иначе полоска «1 000» в тихую неделю
        // выглядела бы такой же длинной, как «8 000» в пиковую.
        const max = Math.max(1, ...row.weeks.map((w) => Math.max(w.forecast, w.planned)));
        const month = stateText(forecast, planned);
        return (
          <section key={row.flowerType} className="card space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-semibold">{row.label}</h2>
              <div className="text-sm tabular-nums text-ink-secondary">
                срезка <span className="font-medium text-ink-primary">{forecast > 0 ? nf(forecast) : "—"}</span>
                {" · "}план <span className="font-medium text-ink-primary">{planned > 0 ? nf(planned) : "—"}</span>
                {" · "}
                <span className={clsx("font-medium", month.tone)}>{month.text}</span>
                {top > 0 && forecast > 0 && (
                  <span className="text-ink-muted"> · высшей {Math.round((top / forecast) * 100)} %</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
              {row.weeks.map((w) => {
                const s = stateText(w.forecast, w.planned);
                const state = weekState(w.forecast, w.planned);
                return (
                  <div
                    key={w.code}
                    className={clsx(
                      "rounded-lg border px-3 py-2 space-y-1.5",
                      state === "short"
                        ? "border-status-critical/40 bg-status-critical/5"
                        : "border-line-hairline",
                      w.code === currentWeek && "ring-1 ring-accent/50"
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-1 text-xs text-ink-secondary">
                      <span className="font-medium text-ink-primary">Нед. {w.index}</span>
                      <span className="whitespace-nowrap">{w.label}</span>
                    </div>
                    <div className="space-y-1" aria-hidden>
                      <Bar value={w.forecast} max={max} className="bg-accent" />
                      <Bar value={w.planned} max={max} className="bg-ink-secondary/70" />
                    </div>
                    <div className="text-xs tabular-nums text-ink-secondary">
                      {w.forecast > 0 ? nf(w.forecast) : "—"} / {w.planned > 0 ? nf(w.planned) : "—"}
                    </div>
                    <div className={clsx("text-xs font-medium tabular-nums", s.tone)}>{s.text}</div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
