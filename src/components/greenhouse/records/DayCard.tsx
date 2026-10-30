import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { blockName, type DayRecords, type RecordIssue } from "@/lib/greenhouse/records";
import { ghHref } from "@/lib/greenhouse/farm";
import { GRADE_COLORS, GRADE_SHORT } from "@/lib/greenhouse/views";

/**
 * Карточка дня во «Записях» (30.10.2026): сверху — что внесено за день по журналам, внутри — лист дня как в книге
 * агронома. Номер блока — ссылка на «Внести день» с этим днём и блоком: правят там. Без "use client".
 */

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const n0 = (n: number) => Math.round(n).toLocaleString("ru-RU");
const gShort = (g: string) => GRADE_SHORT[g] ?? g;

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-hairline bg-surface px-2.5 py-0.5 text-xs whitespace-nowrap">
      <span className="w-2 h-2 rounded-full flex-none" style={{ background: tone }} />
      {children}
    </span>
  );
}

function SectionHead({ title, note, href, canEdit }: { title: string; note?: string; href: string; canEdit: boolean }) {
  return (
    <div className="flex items-baseline gap-2 mb-1.5">
      <h4 className="text-[13px] font-semibold">{title}</h4>
      {note && <span className="text-xs text-ink-muted">{note}</span>}
      {canEdit && (
        <Link href={href} className="ml-auto text-xs text-section-greenhouse hover:underline whitespace-nowrap">
          править →
        </Link>
      )}
    </div>
  );
}

export default function DayCard({ day, farm, today, canEdit, open, issues, maxHarvest }: { day: DayRecords; farm: string; today: string; canEdit: boolean; open: boolean; issues: RecordIssue[]; maxHarvest: number }) {
  const d = new Date(`${day.date}T00:00:00Z`);
  const wd = WEEKDAYS[d.getUTCDay()];
  const label = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${day.date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${day.date.slice(0, 4)}`}`;
  const dayHref = (section: string, block?: string) => ghHref("/greenhouse/day", farm, { date: day.date, section, block });
  const single = (list: { block: string }[]) => (new Set(list.map((r) => r.block)).size === 1 ? list[0]?.block : undefined);
  const gradeTotals = Object.fromEntries(day.grades.map((g) => [g, day.harvest.reduce((s, r) => s + (r.byGrade[g] ?? 0), 0)]));

  return (
    <details open={open} className="card !p-0 group">
      <summary className="list-none cursor-pointer flex items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="w-24 flex-none">
          <div className="font-display font-bold text-[15px] leading-tight">{label}</div>
          <div className={clsx("text-xs", wd === "вс" ? "text-[#a12b2b]" : "text-ink-muted")}>
            {day.date === today ? "сегодня" : wd}
          </div>
        </div>
        <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
          {day.harvestTotal > 0 && (
            <Chip tone="#2f8a55">
              Срезка <b className="tabular-nums">{n0(day.harvestTotal)}</b>
              <span className="text-ink-muted hidden sm:inline">
                · {day.harvestBlocks.length === 1 ? "блок" : "блоки"} {day.harvestBlocks.map((b) => (/^\d+$/.test(b) ? b : blockName(b))).join(", ")}
              </span>
            </Chip>
          )}
          {day.wasteTotal > 0 && (
            <Chip tone="#c9584e">
              Брак <b className="tabular-nums">{n0(day.wasteTotal)}</b>
            </Chip>
          )}
          {day.cuttings.length > 0 && (
            <Chip tone="#e2a13b">
              Черенкование <b className="tabular-nums">{day.cuttings.length}</b>
            </Chip>
          )}
          {day.workPeople > 0 && (
            <Chip tone="#4f7fb8">
              Выработка <b className="tabular-nums">{day.workPeople}</b> чел.
            </Chip>
          )}
          {issues.length > 0 && <span className="inline-flex items-center rounded-full bg-[#fdf1e3] text-[#8a5a00] px-2.5 py-0.5 text-xs">⚠ {issues.length}</span>}
        </div>
        {maxHarvest > 0 && (
          <span className="hidden md:block w-28 h-1.5 rounded-full bg-surface-sunk overflow-hidden flex-none" title="срезка дня к самому большому дню периода">
            <span className="block h-full rounded-full bg-[#2f8a55]/60" style={{ width: `${(day.harvestTotal * 100) / maxHarvest}%` }} />
          </span>
        )}
        <span className="text-ink-muted transition-transform group-open:rotate-180 flex-none">⌄</span>
      </summary>

      <div className="border-t border-line-hairline px-4 py-3 space-y-5">
        {issues.length > 0 && (
          <ul className="space-y-1">
            {issues.map((x, i) => (
              <li key={i} className="text-xs text-[#8a5a00]">
                ⚠ {x.text}
              </li>
            ))}
          </ul>
        )}

        {day.harvest.length > 0 && (
          <section>
            <SectionHead title="Срезка" note={`${n0(day.harvestTotal)} шт.`} href={dayHref("harvest", single(day.harvest))} canEdit={canEdit} />
            {/* Компьютер: лист как в книге — строка «блок · сорт», категории в ряд. */}
            <table className="hidden sm:table w-full text-sm">
              <thead>
                <tr className="text-xs text-ink-muted border-b border-line-hairline">
                  <th className="text-left font-medium py-1.5 pr-3">Блок · сорт</th>
                  {day.grades.map((g) => (
                    <th key={g} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">
                      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: GRADE_COLORS[g] ?? "#bbb" }} />
                      {gShort(g)}
                    </th>
                  ))}
                  <th className="text-right font-medium py-1.5 px-2">Всего</th>
                  <th className="text-right font-medium py-1.5 pl-2">г/шт</th>
                </tr>
              </thead>
              <tbody>
                {day.harvest.map((r) => (
                  <tr key={`${r.block}-${r.cycle}-${r.variety}`} className="border-b border-line-hairline/60 last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {canEdit ? (
                        <Link href={dayHref("harvest", r.block)} className="hover:underline">
                          {blockName(r.block)}
                        </Link>
                      ) : (
                        blockName(r.block)
                      )}
                      <span className="text-ink-muted"> · {r.variety}</span>
                      <span className="text-[11px] text-ink-muted ml-1">ц.{r.cycle}</span>
                    </td>
                    {day.grades.map((g) => (
                      <td key={g} className="py-1.5 px-2 text-right tabular-nums">
                        {r.byGrade[g] ? n0(r.byGrade[g]) : <span className="text-ink-muted/50">·</span>}
                      </td>
                    ))}
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{n0(r.total)}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-ink-secondary">{r.avgG ?? "—"}</td>
                  </tr>
                ))}
                {day.harvest.length > 1 && (
                  <tr className="border-t border-line-hairline text-ink-secondary">
                    <td className="py-1.5 pr-3 text-xs">Итого дня</td>
                    {day.grades.map((g) => (
                      <td key={g} className="py-1.5 px-2 text-right tabular-nums text-xs">
                        {n0(gradeTotals[g])}
                        <div className="text-[10px] text-ink-muted">{Math.round((gradeTotals[g] * 100) / day.harvestTotal)}%</div>
                      </td>
                    ))}
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-ink-primary">{n0(day.harvestTotal)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
            {/* Телефон: строка «блок · сорт» и категории плашками. */}
            <ul className="sm:hidden divide-y divide-line-hairline/60">
              {day.harvest.map((r) => (
                <li key={`${r.block}-${r.cycle}-${r.variety}`} className="py-2">
                  <div className="flex items-baseline gap-2 text-sm">
                    {canEdit ? (
                      <Link href={dayHref("harvest", r.block)} className="font-medium hover:underline">
                        {blockName(r.block)}
                      </Link>
                    ) : (
                      <span className="font-medium">{blockName(r.block)}</span>
                    )}
                    <span className="text-ink-secondary truncate min-w-0">{r.variety}</span>
                    <span className="ml-auto font-semibold tabular-nums">{n0(r.total)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-ink-secondary">
                    {day.grades
                      .filter((g) => r.byGrade[g])
                      .map((g) => (
                        <span key={g} className="whitespace-nowrap">
                          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: GRADE_COLORS[g] ?? "#bbb" }} />
                          {gShort(g)} <b className="tabular-nums text-ink-primary font-medium">{n0(r.byGrade[g])}</b>
                        </span>
                      ))}
                    {r.avgG && <span className="text-ink-muted">{r.avgG} г/шт</span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {day.waste.length > 0 && (
          <section>
            <SectionHead title="Брак на блоках" note={`${n0(day.wasteTotal)} шт.`} href={dayHref("waste", single(day.waste))} canEdit={canEdit} />
            <ul className="divide-y divide-line-hairline/60 text-sm">
              {day.waste.map((r, i) => (
                <li key={i} className="py-1.5 flex items-baseline gap-2">
                  <span className="whitespace-nowrap">{blockName(r.block)}</span>
                  <span className="text-ink-secondary truncate min-w-0">
                    {r.variety} · {r.label}
                    {r.extra && <span className="text-ink-muted"> · {r.extra}</span>}
                  </span>
                  <span className="ml-auto tabular-nums font-medium">{n0(r.qty)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {day.cuttings.length > 0 && (
          <section>
            <SectionHead title="Черенкование" href={dayHref("cuttings", single(day.cuttings))} canEdit={canEdit} />
            <ul className="divide-y divide-line-hairline/60 text-sm">
              {day.cuttings.map((r, i) => (
                <li key={i} className="py-1.5 flex items-baseline gap-2">
                  <span className="whitespace-nowrap">
                    {blockName(r.block)} <span className="text-[11px] text-ink-muted">ц.{r.cycle}</span>
                  </span>
                  <span className="text-ink-secondary truncate min-w-0">
                    {r.variety} · {r.label}
                    {r.extra && <span className="text-ink-muted"> · {r.extra}</span>}
                  </span>
                  <span className="ml-auto tabular-nums font-medium">{n0(r.qty)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {day.work.length > 0 && (
          <section>
            <SectionHead title="Выработка" note={`${day.workPeople} чел.`} href={dayHref("people")} canEdit={canEdit} />
            <div className="space-y-1">
              {day.work.map((a) => (
                <details key={a.area} className="rounded-lg border border-line-hairline">
                  <summary className="cursor-pointer list-none flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                    <span className="font-medium">{a.label}</span>
                    <span className="text-ink-secondary">{a.people} чел.</span>
                    {a.qty > 0 && <span className="text-ink-secondary tabular-nums">{n0(a.qty)} шт.</span>}
                    {a.hours > 0 && <span className="text-ink-secondary tabular-nums">{a.hours.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ч</span>}
                    <span className="ml-auto text-xs text-ink-muted">кто что сделал ⌄</span>
                  </summary>
                  <ul className="border-t border-line-hairline divide-y divide-line-hairline/60 px-3 text-sm">
                    {a.rows.map((r, i) => (
                      <li key={i} className="py-1.5 flex items-baseline gap-2">
                        <span className="truncate min-w-0">
                          {r.name}
                          {!r.hasCard && <span className="ml-1 text-[11px] text-[#8a5a00]">без карточки</span>}
                        </span>
                        <span className="text-xs text-ink-muted whitespace-nowrap">
                          {r.typeLabel}
                          {r.block ? ` · ${blockName(r.block)}` : ""}
                        </span>
                        <span className="ml-auto tabular-nums whitespace-nowrap">
                          {r.qty ? n0(r.qty) : ""}
                          {r.qty && r.hours ? " · " : ""}
                          {r.hours ? `${r.hours.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ч` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        )}
      </div>
    </details>
  );
}
