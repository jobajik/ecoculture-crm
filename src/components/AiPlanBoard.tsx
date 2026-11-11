"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { askAiPlanAction, saveAiPlanAction } from "@/app/plans/ai/actions";
import { unwrapValue } from "@/lib/actionResult";
import { formatMoment } from "@/lib/formatDate";
import { SCENARIOS, scaleQtyRow, type AiAdvice, type AiPlan, type Qty } from "@/lib/aiPlan";
import { type AiPlanSnapshot } from "@/app/plans/ai/data";

const TD = "px-2.5 sm:px-3 py-2 align-top";
const TDN = "px-2 sm:px-2.5 py-2 text-right tabular-nums whitespace-nowrap align-top";
const TH = "px-2.5 sm:px-3 py-2 font-medium text-left";
const THN = "px-2 sm:px-2.5 py-2 font-medium text-right whitespace-nowrap";
const TROW = "border-b border-line-hairline last:border-0";
const TTOT = "border-t border-line-hairline bg-surface-plane/60 font-semibold";
const THEAD = "border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted";

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${nf(n)} ₸`;
const mln = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₸` : money(n));
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const sumOf = (row: Record<string, Qty>, by: "sum" | "stems") => Object.values(row).reduce((a, x) => a + x[by], 0);

/**
 * «План с ИИ» — экран владельца (11.11.2026). Сервер уже посчитал раскладку (`buildAiPlan`); здесь её можно спросить у
 * ИИ (множители долей + объяснения, расчёт приходит заново с сервера), поправить руками сумму менеджера или объём
 * направления и записать в «Планы продаж» и «План отгрузок». Ничего не пишется до кнопки «Сохранить».
 */
export default function AiPlanBoard({
  plan: initial,
  snapshot,
  flowerLabels,
  monthLabel,
  aiReady,
}: {
  plan: AiPlan;
  snapshot: AiPlanSnapshot | null;
  flowerLabels: Record<string, string>;
  monthLabel: string;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState(initial);
  const [advice, setAdvice] = useState<AiAdvice | null>(null);
  const [model, setModel] = useState("");
  const [comment, setComment] = useState("");
  const [mgrEdit, setMgrEdit] = useState<Record<string, string>>({});
  const [dirEdit, setDirEdit] = useState<Record<string, string>>({});
  const [saveManagers, setSaveManagers] = useState(true);
  const [saveDirections, setSaveDirections] = useState(true);
  const [busy, setBusy] = useState<"" | "ai" | "save">("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const prices = useMemo(() => Object.fromEntries(plan.flowers.map((f) => [f.flowerType, f.price])), [plan]);
  const label = (f: string) => flowerLabels[f] ?? f;

  // Строки с правками человека: новая сумма менеджера или объём направления масштабируют цветки в той же пропорции.
  const managers = plan.managers.map((m) => {
    const raw = mgrEdit[m.email];
    const byFlower = raw === undefined || raw === "" ? m.byFlower : scaleQtyRow(m.byFlower, "sum", Number(raw.replace(/\s/g, "")), prices);
    const left = { stems: sumOf(byFlower, "stems"), sum: sumOf(byFlower, "sum") };
    return { ...m, byFlower, left, monthSum: m.fact.sum + left.sum, edited: raw !== undefined && raw !== "" && Math.round(Number(raw.replace(/\s/g, ""))) !== m.target.sum };
  });
  const directions = plan.directions.map((d) => {
    const raw = dirEdit[d.direction];
    const byFlower = raw === undefined || raw === "" ? d.byFlower : scaleQtyRow(d.byFlower, "stems", Number(raw.replace(/\s/g, "")), Object.fromEntries(plan.flowers.map((f) => [f.flowerType, 0.0001])));
    return { ...d, byFlower, left: sumOf(byFlower, "stems"), edited: raw !== undefined && raw !== "" && Math.round(Number(raw.replace(/\s/g, ""))) !== d.target.stems };
  });

  const real = managers.filter((m) => !m.virtual);
  const leftSum = managers.reduce((a, m) => a + m.left.sum, 0);
  const monthSum = plan.clientsFact + leftSum;
  const sellable = plan.flowers.reduce((a, f) => a + f.sellable, 0);
  const targetStems = plan.flowers.reduce((a, f) => a + f.targetLeft, 0);
  const surplus = plan.flowers.reduce((a, f) => a + Math.max(0, f.gap), 0);
  const currentTotal = real.reduce((a, m) => a + m.current, 0);

  async function ask() {
    setError(null);
    setDone(null);
    setBusy("ai");
    try {
      const r = unwrapValue(await askAiPlanAction(plan.month, plan.scenario, comment));
      setPlan(r.plan);
      setAdvice(r.advice);
      setModel(r.model);
      setMgrEdit({});
      setDirEdit({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "ИИ не ответил — попробуйте ещё раз");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setError(null);
    setDone(null);
    if (!saveManagers && !saveDirections) return setError("Отметьте, что записать: план менеджеров, план отгрузок или оба");
    setBusy("save");
    try {
      const r = unwrapValue(
        await saveAiPlanAction({
          month: plan.month,
          scenario: plan.scenario,
          comment,
          model,
          advice,
          managers: real.map((m) => ({ email: m.email, byFlower: m.byFlower })),
          directions: directions.map((d) => ({ direction: d.direction, byFlower: d.byFlower })),
          saveManagers,
          saveDirections,
        })
      );
      const parts = [];
      if (r.managerRows) parts.push(`план продаж менеджеров (${r.managerRows} строк)`);
      if (r.directionRows) parts.push(`план отгрузок по неделям (${r.directionRows} строк)`);
      setDone(parts.length ? `Записано: ${parts.join(" и ")}.` : "Записывать было нечего.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy("");
    }
  }

  const shownAdvice = advice ?? null;
  // История в таблицах — от старых к свежим; неполный текущий месяц в неё не идёт: он стоит в «Уже продал».
  const hist = plan.periods.map((p, i) => ({ p, i })).filter((x) => !(plan.isCurrent && x.p.partial)).reverse();
  const factDays = plan.periods.find((p) => p.partial)?.days ?? 0;
  const perDay = (value: number, days: number) => (days > 0 && value > 0 ? <div className="text-[11.5px] text-ink-muted">{nf(value / days)} в день</div> : null);

  return (
    <div className="space-y-4">
      {/* Главные цифры */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile label={`План продаж на ${monthLabel}`} value={mln(monthSum)} hint={currentTotal > 0 ? `сейчас в CRM стоит ${mln(currentTotal)}` : "в CRM план ещё не поставлен"} />
        <Tile label="Уже продано" value={mln(plan.clientsFact)} hint={plan.isCurrent ? `${pct(plan.clientsFact, monthSum)} плана · осталось ${plan.daysLeft} дн.` : "месяц ещё не начался"} />
        <Tile label="Осталось продать" value={mln(leftSum)} hint={plan.daysLeft > 0 ? `по ${mln(leftSum / plan.daysLeft)} в день` : ""} />
        <Tile
          label="Цветка на эти дни"
          value={`${nf(sellable)} шт.`}
          hint={surplus > 0 ? `в плане ${nf(targetStems)} · лишних ${nf(surplus)}` : `в плане ${nf(targetStems)} — весь цветок расписан`}
          tone={surplus > 0 ? "warn" : undefined}
        />
      </div>

      {/* Хватит ли цветка */}
      <section className="card overflow-hidden">
        <Head title="Хватит ли цветка" note={`с ${plan.from.slice(8, 10)}.${plan.from.slice(5, 7)} по ${plan.to.slice(8, 10)}.${plan.to.slice(5, 7)}, стебли`} />
        <div className="table-scroll">
          <table className="w-full text-[13px]" style={{ minWidth: 860 }}>
            <thead>
              <tr className={THEAD}>
                <th className={TH}>Цветок</th>
                <th className={THN}>На складе</th>
                <th className={THN}>Срежем</th>
                <th className={THN}>Спишем</th>
                <th className={THN}>Можно продать</th>
                <th className={THN}>По темпу продаж</th>
                <th className={THN}>В плане</th>
                <th className={THN}>Останется</th>
              </tr>
            </thead>
            <tbody>
              {plan.flowers.map((f) => (
                <tr key={f.flowerType} className={TROW}>
                  <td className={`${TD} font-medium text-ink-primary`}>{label(f.flowerType)}</td>
                  <td className={TDN}>{nf(f.stock)}</td>
                  <td className={TDN}>
                    {nf(f.forecastLeft)}
                    {f.forecastSource !== "agronomist" && <div className="text-[11px] text-status-serious">{f.forecastSource === "average" ? "среднее, прогноза нет" : "нет данных"}</div>}
                  </td>
                  <td className={TDN}>{Math.round(f.writeoffShare * 100)}%</td>
                  <td className={`${TDN} font-medium`}>{nf(f.sellable)}</td>
                  <td className={TDN}>{nf(f.demandLeft)}</td>
                  <td className={`${TDN} font-semibold`}>{nf(f.targetLeft)}</td>
                  <td className={`${TDN} ${f.gap > 0 ? "text-status-serious" : ""}`}>{f.gap > 0 ? `+${nf(f.gap)}` : f.gap < 0 ? nf(f.gap) : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-3 sm:px-4 py-3 text-[12.5px] text-ink-muted border-t border-line-hairline">
          «Можно продать» — склад плюс срезка минус ожидаемые списания. «Останется» с плюсом — цветок, на который плана нет: без нового канала или акции он уйдёт в списание.
        </p>
      </section>

      {/* Совет ИИ */}
      <section className="card p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink-primary">Совет ИИ</h2>
          {model && <span className="text-xs text-ink-muted">модель {model}</span>}
        </div>
        <p className="text-[13px] text-ink-secondary">
          Ниже — раскладка программы: по истории продаж, складу и срезке. ИИ посмотрит на неё и предложит, кому прибавить, кому убавить и куда вести лишний цветок — с объяснением у каждой строки. Общий план по цветку от его совета не меняется, меняются доли.
        </p>
        <textarea
          className="input min-h-[64px]"
          placeholder="Что учесть (необязательно): «Ильгар в отпуске с 20-го», «упор на хризантему 3-й категории», «в Астану вторая фура с декабря»"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={600}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={busy !== "" || !aiReady} onClick={ask}>
            {busy === "ai" ? "ИИ думает, до минуты…" : advice ? "Спросить ещё раз" : "Спросить ИИ"}
          </button>
          {!aiReady && <span className="text-[13px] text-status-serious">ИИ не подключён — раскладка программы работает и без него.</span>}
          {advice && <span className="text-[13px] text-ink-muted">Цифры в таблицах ниже уже с советом ИИ.</span>}
        </div>
        {shownAdvice && <AdviceText advice={shownAdvice} />}
        {!shownAdvice && snapshot?.advice && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-secondary">Что советовал ИИ, когда план сохраняли в прошлый раз</summary>
            <div className="mt-2">
              <AdviceText advice={snapshot.advice} />
            </div>
          </details>
        )}
      </section>

      {/* Менеджеры */}
      <section className="card overflow-hidden">
        <Head title="Менеджеры" note="клиентские продажи, ₸" />
        <div className="table-scroll">
          <table className="w-full text-[13px]" style={{ minWidth: 980 }}>
            <thead>
              <tr className={THEAD}>
                <th className={TH}>Менеджер</th>
                {hist.map((h) => (
                  <th key={h.p.label} className={THN}>
                    {h.p.label}
                  </th>
                ))}
                {plan.isCurrent && <th className={THN}>Уже продал</th>}
                <th className={THN}>План на остаток</th>
                <th className={THN}>В день</th>
                <th className={THN}>План на месяц</th>
                <th className={TH}>Почему так</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => (
                <tr key={m.email} className={TROW}>
                  <td className={TD}>
                    <div className="font-medium text-ink-primary">{m.name}</div>
                    <div className="text-[11.5px] text-ink-muted">{m.virtual ? "в план менеджеров не пишется" : m.isNew ? "новый" : `клиентов ${m.clients}`}</div>
                  </td>
                  {hist.map((h) => (
                    <td key={h.i} className={`${TDN} text-ink-secondary`}>
                      {nf(m.history[h.i] ?? 0)}
                      {perDay(m.history[h.i] ?? 0, h.p.days)}
                    </td>
                  ))}
                  {plan.isCurrent && (
                    <td className={TDN}>
                      {nf(m.fact.sum)}
                      {perDay(m.fact.sum, factDays)}
                    </td>
                  )}
                  <td className={TDN}>
                    {m.virtual ? (
                      nf(m.left.sum)
                    ) : (
                      <input
                        className={`input !w-32 !py-1 !px-2 text-right tabular-nums ${m.edited ? "!border-accent" : ""}`}
                        inputMode="numeric"
                        aria-label={`План на остаток, ${m.name}`}
                        value={mgrEdit[m.email] ?? nf(m.target.sum)}
                        onChange={(e) => setMgrEdit((s) => ({ ...s, [m.email]: e.target.value.replace(/[^\d\s]/g, "") }))}
                      />
                    )}
                    <div className="text-[11.5px] text-ink-muted">
                      {Object.entries(m.byFlower)
                        .filter(([, x]) => x.stems > 0)
                        .map(([f, x]) => `${label(f).split(" ")[0].toLowerCase()} ${nf(x.stems)}`)
                        .join(" · ") || "—"}
                    </div>
                  </td>
                  <td className={`${TDN} text-ink-secondary`}>{plan.daysLeft > 0 ? nf(m.left.sum / plan.daysLeft) : "—"}</td>
                  <td className={`${TDN} font-semibold`}>
                    {nf(m.monthSum)}
                    {!m.virtual && m.current > 0 && <div className="text-[11.5px] font-normal text-ink-muted">в CRM {nf(m.current)}</div>}
                  </td>
                  <td className={`${TD} text-ink-secondary min-w-[220px]`}>{m.edited ? "Поправлено вручную." : m.reason || "По доле в продажах за историю."}</td>
                </tr>
              ))}
              <tr className={TTOT}>
                <td className={TD}>Итого</td>
                {hist.map((h) => (
                  <td key={h.i} className={TDN}>
                    {nf(managers.reduce((a, m) => a + (m.history[h.i] ?? 0), 0))}
                    {perDay(managers.reduce((a, m) => a + (m.history[h.i] ?? 0), 0), h.p.days)}
                  </td>
                ))}
                {plan.isCurrent && (
                  <td className={TDN}>
                    {nf(plan.clientsFact)}
                    {perDay(plan.clientsFact, factDays)}
                  </td>
                )}
                <td className={TDN}>{nf(leftSum)}</td>
                <td className={TDN}>{plan.daysLeft > 0 ? nf(leftSum / plan.daysLeft) : "—"}</td>
                <td className={TDN}>{nf(monthSum)}</td>
                <td className={TD} />
              </tr>
            </tbody>
          </table>
        </div>
        {plan.departed.length > 0 && (
          <p className="px-3 sm:px-4 py-3 text-[12.5px] text-ink-muted border-t border-line-hairline">
            В истории есть клиентские продажи тех, кто не числится менеджером ({plan.departed.map((d) => `${d.name} — ${mln(d.sum)}`).join(", ")}): их доля роздана менеджерам. «Уже продал» в итоге считает и их заявки этого месяца.
          </p>
        )}
      </section>

      {/* Каналы */}
      <section className="card overflow-hidden">
        <Head title="Каналы" note="куда уходит цветок, стебли" />
        <div className="table-scroll">
          <table className="w-full text-[13px]" style={{ minWidth: 820 }}>
            <thead>
              <tr className={THEAD}>
                <th className={TH}>Канал</th>
                {hist.map((h) => (
                  <th key={h.p.label} className={THN}>
                    {h.p.label}
                  </th>
                ))}
                {plan.isCurrent && <th className={THN}>Уже ушло</th>}
                <th className={THN}>План на остаток</th>
                <th className={THN}>Доля</th>
                <th className={TH}>По цветкам и почему</th>
              </tr>
            </thead>
            <tbody>
              {plan.channels.map((c) => (
                <tr key={c.channel} className={TROW}>
                  <td className={`${TD} font-medium text-ink-primary`}>{c.label}</td>
                  {hist.map((h) => (
                    <td key={h.i} className={`${TDN} text-ink-secondary`}>
                      {nf(c.history[h.i] ?? 0)}
                      {perDay(c.history[h.i] ?? 0, h.p.days)}
                    </td>
                  ))}
                  {plan.isCurrent && (
                    <td className={TDN}>
                      {nf(c.fact.stems)}
                      {perDay(c.fact.stems, factDays)}
                    </td>
                  )}
                  <td className={`${TDN} font-semibold`}>
                    {nf(c.target.stems)}
                    {perDay(c.target.stems, plan.daysLeft)}
                  </td>
                  <td className={TDN}>{pct(c.target.stems, targetStems)}</td>
                  <td className={`${TD} text-ink-secondary min-w-[240px]`}>
                    <div>
                      {Object.entries(c.byFlower)
                        .filter(([, x]) => x.stems > 0)
                        .map(([f, x]) => `${label(f)} ${nf(x.stems)}`)
                        .join(" · ") || "—"}
                    </div>
                    {c.reason && <div className="mt-0.5">{c.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Направления */}
      {directions.length > 0 && (
        <section className="card overflow-hidden">
          <Head title="Направления отгрузок" note="регионы, экспорт, точка — стебли" />
          <div className="table-scroll">
            <table className="w-full text-[13px]" style={{ minWidth: 820 }}>
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Направление</th>
                  {hist.map((h) => (
                    <th key={h.p.label} className={THN}>
                      {h.p.label}
                    </th>
                  ))}
                  {plan.isCurrent && <th className={THN}>Уже ушло</th>}
                  <th className={THN}>План на остаток</th>
                  <th className={TH}>По цветкам и почему</th>
                </tr>
              </thead>
              <tbody>
                {directions.map((d) => (
                  <tr key={d.direction} className={TROW}>
                    <td className={`${TD} font-medium text-ink-primary`}>{d.direction}</td>
                    {hist.map((h) => (
                      <td key={h.i} className={`${TDN} text-ink-secondary`}>
                        {nf(d.history[h.i] ?? 0)}
                        {perDay(d.history[h.i] ?? 0, h.p.days)}
                      </td>
                    ))}
                    {plan.isCurrent && (
                      <td className={TDN}>
                        {nf(d.fact)}
                        {perDay(d.fact, factDays)}
                      </td>
                    )}
                    <td className={TDN}>
                      <input
                        className={`input !w-28 !py-1 !px-2 text-right tabular-nums ${d.edited ? "!border-accent" : ""}`}
                        inputMode="numeric"
                        aria-label={`План на остаток, ${d.direction}`}
                        value={dirEdit[d.direction] ?? nf(d.target.stems)}
                        onChange={(e) => setDirEdit((s) => ({ ...s, [d.direction]: e.target.value.replace(/[^\d\s]/g, "") }))}
                      />
                    </td>
                    <td className={`${TD} text-ink-secondary min-w-[240px]`}>
                      <div>
                        {Object.entries(d.byFlower)
                          .filter(([, x]) => x.stems > 0)
                          .map(([f, x]) => `${label(f)} ${nf(x.stems)}`)
                          .join(" · ") || "—"}
                      </div>
                      {(d.edited || d.reason) && <div className="mt-0.5">{d.edited ? "Поправлено вручную." : d.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 sm:px-4 py-3 text-[12.5px] text-ink-muted border-t border-line-hairline">
            Это другой срез тех же продаж — «куда едет»: сюда входят и объём на город, и клиентские заявки менеджеров в эти направления. В «План отгрузок» запишется по неделям, начиная с текущей.
          </p>
        </section>
      )}

      {plan.notes.length > 0 && (
        <section className="card p-3 sm:p-4">
          <h2 className="text-[15px] font-semibold text-ink-primary mb-2">На чём держится расчёт</h2>
          <ul className="list-disc pl-5 space-y-1 text-[13px] text-ink-secondary">
            <li>
              История: {plan.periods.map((p) => `${p.label} (вес ${Math.round(p.weight * 100)}%)`).join(", ")}. Сравнивается продажа в день, поэтому неполный месяц считается честно.
            </li>
            {plan.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Сохранение */}
      <section className="card p-3 sm:p-4 space-y-3">
        <h2 className="text-[15px] font-semibold text-ink-primary">Записать план в CRM</h2>
        <label className="flex items-start gap-2 text-[13px] text-ink-secondary">
          <input type="checkbox" className="mt-0.5" checked={saveManagers} onChange={(e) => setSaveManagers(e.target.checked)} />
          <span>
            <b className="font-medium text-ink-primary">План продаж менеджерам на {monthLabel}</b> — {mln(real.reduce((a, m) => a + m.monthSum, 0))} на {real.length} чел. Запишется план на месяц целиком (уже продано плюс остаток) и заменит тот, что стоит сейчас. Менеджеры увидят его в рейтинге и в «Моём дне».
          </span>
        </label>
        <label className="flex items-start gap-2 text-[13px] text-ink-secondary">
          <input type="checkbox" className="mt-0.5" checked={saveDirections} onChange={(e) => setSaveDirections(e.target.checked)} />
          <span>
            <b className="font-medium text-ink-primary">План отгрузок по направлениям</b> — {nf(directions.reduce((a, d) => a + d.left, 0))} шт. по {directions.length} направлениям, по неделям с текущей. Прошедшие недели не трогаются.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={busy !== ""} onClick={save}>
            {busy === "save" ? "Записываю…" : "Сохранить план"}
          </button>
          {snapshot && (
            <span className="text-[12.5px] text-ink-muted">
              Последний раз сохраняли {formatMoment(snapshot.at)} · {SCENARIOS.find((s) => s.code === snapshot.scenario)?.label ?? ""}
            </span>
          )}
        </div>
        {error && <div className="text-[13px] text-status-critical">{error}</div>}
        {done && <div className="text-[13px] text-accent">{done}</div>}
      </section>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="card p-3 sm:p-4 min-w-0">
      <div className="text-[12.5px] leading-4 text-ink-secondary">{label}</div>
      <div className="mt-1 text-[20px] sm:text-[22px] leading-7 font-semibold text-ink-primary tabular-nums truncate">{value}</div>
      {hint && <div className={`mt-0.5 text-[12px] leading-4 ${tone === "warn" ? "text-status-serious" : "text-ink-muted"}`}>{hint}</div>}
    </div>
  );
}

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 sm:px-4 py-3 border-b border-line-hairline">
      <h2 className="text-[15px] font-semibold text-ink-primary">{title}</h2>
      {note && <span className="text-[12.5px] text-ink-muted">{note}</span>}
    </div>
  );
}

function AdviceText({ advice }: { advice: AiAdvice }) {
  return (
    <div className="rounded-lg bg-surface-plane/70 p-3 space-y-3 text-[13px] text-ink-primary">
      {advice.summary && <p>{advice.summary}</p>}
      {advice.actions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-ink-muted mb-1">Что сделать</div>
          <ul className="list-disc pl-5 space-y-1">
            {advice.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {advice.risks.length > 0 && (
        <div>
          <div className="text-xs font-medium text-ink-muted mb-1">Риски</div>
          <ul className="list-disc pl-5 space-y-1 text-ink-secondary">
            {advice.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
