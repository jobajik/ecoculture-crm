"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { savePricesAction } from "@/app/prices/actions";
import { FLOWER_TYPE_LABELS_PLURAL, formatGrade, getGradesFor } from "@/lib/constants";
import { BASE_VARIETY, priceKey } from "@/lib/priceList";
import { groupVarietiesByPrice, type PriceGroup } from "@/lib/priceGroups";
import { formatNumber, parseNumber } from "./NumberCell";
import Hint from "./Hint";
import SaveBar from "./SaveBar";
import { unwrap } from "@/lib/actionResult";

/**
 * Прайс-лист: строка на ГРУППУ сортов с одинаковой ценой.
 *
 * Как прайс устроен на деле (живая база, сентябрь): у розы 21 сорт с ценой, но
 * ценовых рядов всего три — тринадцать сортов стоят 160/180/220/240, три
 * спрея по 730–830, два по 370–430 — плюс три мини-микса. У хризантемы девять
 * сортов одной ценой и один свой. Сетка «сорт × длина» давала двадцать строк
 * одинаковых чисел, список «особых цен» — сто двадцать семь строк. Владелец:
 * «это ужасно».
 *
 * Поэтому строка здесь — группа: «Prestige, Red Naomi, Avalanche и ещё 10 —
 * 160 / 180 / 220 / 240». Правка клетки группы пишет цену КАЖДОМУ её сорту,
 * так что в таблице всё лежит как раньше: цена на сорт, «Все сорта» — общая,
 * сорт без своей цены берёт общую, ноль у сорта — «своей цены нет». Группы
 * считаются из цен при открытии и не перестраиваются, пока человек печатает.
 * Сорт можно перенести в другую группу, выделить отдельно или оставить без
 * своей цены — это просто переписывает его цены ценами группы.
 */
export default function PriceBoard({
  flowerTypes,
  varieties,
  initial,
  canEdit,
  kind = "",
}: {
  flowerTypes: string[];
  varieties: Record<string, string[]>;
  /** Ключ — «цветок|сорт|градация», пустой сорт = цена на все сорта. */
  initial: Record<string, number>;
  canEdit: boolean;
  /** Какой прайс правим: пусто — клиентский, «retail» — внутренний. */
  kind?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // «Отменить» пересобирает и группы: они живут в самих блоках цветков.
  const [version, setVersion] = useState(0);

  const changed = useMemo(() => {
    const out: { flowerType: string; variety: string; grade: string; price: number }[] = [];
    const keys = new Set([...Object.keys(values), ...Object.keys(initial)]);
    for (const key of keys) {
      const now = values[key] ?? 0;
      if (now === (initial[key] ?? 0)) continue;
      const [flowerType, variety, grade] = key.split("|");
      out.push({ flowerType, variety, grade, price: now });
    }
    return out;
  }, [values, initial]);

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      unwrap(await savePricesAction(changed, kind));
      setSaved(`Сохранено цен: ${changed.length}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить прайс");
    } finally {
      setSaving(false);
    }
  }

  function setMany(entries: [string, number][]) {
    setValues((prev) => {
      const next = { ...prev };
      for (const [key, price] of entries) next[key] = price;
      return next;
    });
    setSaved(null);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>
      )}
      {saved && changed.length === 0 && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{saved}</div>
      )}

      {flowerTypes.map((flowerType) => (
        <FlowerPrices
          key={`${flowerType}-${version}`}
          flowerType={flowerType}
          varieties={varieties[flowerType] ?? []}
          values={values}
          initial={initial}
          setMany={setMany}
          canEdit={canEdit}
        />
      ))}

      {canEdit && (
        <SaveBar
          count={changed.length}
          what="цен"
          saving={saving}
          onSave={handleSave}
          onReset={() => {
            setValues(initial);
            setError(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

const NONE = "none";
const SOLO = "solo";

function FlowerPrices({
  flowerType,
  varieties,
  values,
  initial,
  setMany,
  canEdit,
}: {
  flowerType: string;
  varieties: string[];
  values: Record<string, number>;
  initial: Record<string, number>;
  setMany: (entries: [string, number][]) => void;
  canEdit: boolean;
}) {
  const allGrades = getGradesFor(flowerType);
  // Группы считаются один раз при открытии: перестраивать их на каждое
  // нажатие значило бы двигать строки из-под пальца.
  const [start] = useState(() => groupVarietiesByPrice(flowerType, varieties, allGrades, initial));
  const [groups, setGroups] = useState<PriceGroup[]>(start.groups);
  const [none, setNone] = useState<string[]>(start.none);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [allColumns, setAllColumns] = useState(false);

  const k = (variety: string, grade: string) => priceKey(flowerType, variety, grade);
  const val = (variety: string, grade: string) => values[k(variety, grade)] ?? 0;

  // Колонки — только длины, у которых где-то есть цена. У розы пустых длин
  // шесть из пятнадцати, и колонка пустых полей ничего не сообщает.
  const used = allGrades.filter(
    (g) => val(BASE_VARIETY, g) > 0 || varieties.some((v) => val(v, g) > 0 || (initial[k(v, g)] ?? 0) > 0)
  );
  const grades = allColumns || used.length === 0 ? allGrades : used;
  const hidden = allGrades.length - used.length;

  function setGroupPrice(group: PriceGroup, grade: string, price: number) {
    setMany(group.members.map((m) => [k(m, grade), price]));
  }

  /** Перенести сорт: в группу (цены как у неё), отдельно (цены те же) или без своей цены (нули). */
  function move(variety: string, target: string) {
    if (target === NONE) {
      setMany(allGrades.map((g) => [k(variety, g), 0]));
    } else if (target !== SOLO) {
      const to = groups.find((g) => g.id === target);
      if (!to) return;
      setMany(allGrades.map((g) => [k(variety, g), val(to.members[0], g)]));
    }
    const pruned = groups
      .map((g) => ({ ...g, members: g.members.filter((m) => m !== variety) }))
      .filter((g) => g.members.length > 0);
    const restNone = none.filter((m) => m !== variety);
    if (target === NONE) {
      setGroups(pruned);
      setNone([...restNone, variety]);
    } else if (target === SOLO) {
      const id = `s${Date.now()}`;
      setGroups([...pruned, { id, members: [variety] }]);
      setNone(restNone);
      setOpenGroup(null);
    } else {
      setGroups(pruned.map((g) => (g.id === target ? { ...g, members: [...g.members, variety] } : g)));
      setNone(restNone);
    }
  }

  const groupName = (g: PriceGroup) =>
    `как ${g.members[0]}${g.members.length > 1 ? ` и ещё ${g.members.length - 1}` : ""}`;
  const withPrice = varieties.length - none.length;

  return (
    <section className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className="font-semibold">{FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}</h2>
        <span className="text-xs text-ink-muted">
          за стебель · своя цена у {withPrice} сортов из {varieties.length}
          {canEdit && used.length > 0 && hidden > 0 && (
            <button type="button" className="ml-2 text-accent hover:underline" onClick={() => setAllColumns((v) => !v)}>
              {allColumns ? "только заполненные длины" : `+ ещё ${hidden} длин`}
            </button>
          )}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-y border-line-hairline text-ink-secondary">
              <th className="text-left font-medium px-4 py-2 sticky left-0 bg-surface z-10 sm:min-w-[180px]">Сорта</th>
              {grades.map((g) => (
                <th key={g} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  {formatGrade(g)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const open = openGroup === group.id;
              const lead = group.members[0];
              const more = group.members.length - 3;
              return (
                <Fragment key={group.id}>
                  <tr className="group border-b border-line-hairline/70 hover:bg-surface-plane/40">
                    <td className="px-4 py-1 sticky left-0 bg-surface z-10 max-w-[140px] sm:max-w-[300px]">
                      <button
                        type="button"
                        onClick={() => setOpenGroup(open ? null : group.id)}
                        aria-expanded={open}
                        className="block w-full min-w-0 text-left py-1"
                        title={group.members.join(", ")}
                      >
                        {/* На телефоне — одно имя, на компьютере — три: иначе колонка
                            названий съедает экран, и видна одна цена. */}
                        <span className="block truncate sm:hidden">{lead}</span>
                        <span className="hidden sm:block truncate">{group.members.slice(0, 3).join(", ")}</span>
                        {open ? (
                          <span className="block text-xs text-accent">свернуть</span>
                        ) : (
                          <>
                            {group.members.length > 1 && (
                              <span className="block text-xs text-accent sm:hidden">и ещё {group.members.length - 1}</span>
                            )}
                            {more > 0 ? (
                              <span className="hidden sm:block text-xs text-accent">и ещё {more}</span>
                            ) : (
                              canEdit && (
                                <span className="hidden sm:block text-xs text-accent opacity-0 group-hover:opacity-100">
                                  перенести сорт
                                </span>
                              )
                            )}
                          </>
                        )}
                      </button>
                    </td>
                    {grades.map((g) => (
                      <td key={g} className="px-1 py-1 border-l border-line-hairline/70">
                        <Cell
                          value={val(lead, g)}
                          edited={group.members.some((m) => val(m, g) !== (initial[k(m, g)] ?? 0))}
                          canEdit={canEdit}
                          label={`${group.members.join(", ")}, ${formatGrade(g)}`}
                          hintValue={val(BASE_VARIETY, g)}
                          onChange={(v) => setGroupPrice(group, g, v)}
                        />
                      </td>
                    ))}
                  </tr>
                  {open && (
                    <tr className="border-b border-line-hairline/70 bg-surface-plane/40">
                      <td colSpan={grades.length + 1} className="px-4 py-2.5">
                        <MemberList
                          members={group.members}
                          canEdit={canEdit}
                          current={group.id}
                          groups={groups}
                          groupName={groupName}
                          onMove={move}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {/* Общая цена — для сортов без своей. */}
            <tr className="bg-surface-plane/50">
              <td className="px-4 py-1 sticky left-0 bg-surface-plane z-10">
                <div className="py-1">
                  Все остальные
                  <Hint>
                    Общая цена по длине — действует для сорта, у которого своей цены нет. Цена сорта в строках
                    выше её перебивает.
                  </Hint>
                  {none.length > 0 && (
                    <button
                      type="button"
                      className="block text-left text-xs text-ink-muted hover:text-ink-primary"
                      onClick={() => setOpenGroup(openGroup === NONE ? null : NONE)}
                      aria-expanded={openGroup === NONE}
                      title={none.join(", ")}
                    >
                      {none.length > 3 ? `${none.slice(0, 2).join(", ")} и ещё ${none.length - 2}` : none.join(", ")}
                    </button>
                  )}
                </div>
              </td>
              {grades.map((g) => (
                <td key={g} className="px-1 py-1 border-l border-line-hairline/70">
                  <Cell
                    value={val(BASE_VARIETY, g)}
                    edited={val(BASE_VARIETY, g) !== (initial[k(BASE_VARIETY, g)] ?? 0)}
                    canEdit={canEdit}
                    label={`Все сорта, ${formatGrade(g)}`}
                    onChange={(v) => setMany([[k(BASE_VARIETY, g), v]])}
                  />
                </td>
              ))}
            </tr>
            {openGroup === NONE && (
              <tr className="bg-surface-plane/40">
                <td colSpan={grades.length + 1} className="px-4 py-2.5">
                  <MemberList
                    members={none}
                    canEdit={canEdit}
                    current={NONE}
                    groups={groups}
                    groupName={groupName}
                    onMove={move}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Сорта группы; у каждого — куда перенести. */
function MemberList({
  members,
  canEdit,
  current,
  groups,
  groupName,
  onMove,
}: {
  members: string[];
  canEdit: boolean;
  current: string;
  groups: PriceGroup[];
  groupName: (g: PriceGroup) => string;
  onMove: (variety: string, target: string) => void;
}) {
  if (!canEdit) {
    return <p className="text-sm text-ink-secondary">{members.join(", ")}</p>;
  }
  const others = groups.filter((g) => g.id !== current);
  const canSolo = current === NONE || members.length > 1;
  return (
    <div className="flex flex-wrap gap-2">
      {members.map((m) => (
        <label
          key={m}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-hairline bg-surface pl-2.5 pr-1 py-1 text-sm"
        >
          {m}
          <select
            className="rounded-md bg-surface-plane px-1.5 py-0.5 text-xs text-ink-secondary focus:outline-none focus:ring-2 focus:ring-accent/30"
            value=""
            aria-label={`Куда перенести ${m}`}
            onChange={(e) => e.target.value && onMove(m, e.target.value)}
          >
            <option value="">перенести…</option>
            {others.map((g) => (
              <option key={g.id} value={g.id}>
                цены {groupName(g)}
              </option>
            ))}
            {canSolo && <option value={SOLO}>своя цена, отдельной строкой</option>}
            {current !== NONE && <option value={NONE}>без своей цены (общая)</option>}
          </select>
        </label>
      ))}
    </div>
  );
}

/** Клетка цены: без рамки, как в листе таблицы; пустая — тихая подсказка общей ценой. */
function Cell({
  value,
  onChange,
  canEdit,
  label,
  edited,
  hintValue = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  canEdit: boolean;
  label: string;
  edited: boolean;
  /** Что действует, если клетка пуста (общая цена). */
  hintValue?: number;
}) {
  if (!canEdit) {
    return (
      <div className={clsx("px-2 py-1.5 text-right tabular-nums", !value && "text-ink-muted")}>
        {value ? formatNumber(value) : hintValue ? formatNumber(hintValue) : ""}
      </div>
    );
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      value={formatNumber(value)}
      placeholder={hintValue ? formatNumber(hintValue) : ""}
      onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(parseNumber(e.target.value))}
      className={clsx(
        "w-full min-w-[64px] rounded-md bg-transparent px-2 py-1.5 text-right tabular-nums text-base sm:text-sm placeholder:text-ink-muted/60",
        "hover:bg-surface-plane focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40",
        edited && "bg-accent-soft/60 font-medium"
      )}
    />
  );
}
