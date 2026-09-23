"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { savePricesAction } from "@/app/prices/actions";
import { FLOWER_TYPE_LABELS_PLURAL, compareGrades, formatGrade, getGradesFor } from "@/lib/constants";
import { BASE_VARIETY, priceKey } from "@/lib/priceList";
import { parseNumber } from "./NumberCell";
import Hint from "./Hint";
import SaveBar from "./SaveBar";
import { unwrap } from "@/lib/actionResult";

/**
 * Прайс-лист: цена по длине (или категории) на весь цветок и, где нужно,
 * особая цена отдельного сорта.
 *
 * Устроено как читают прайс, а не как он лежит в таблице. Раньше это была
 * сетка «сорта × длины» — у розы пятнадцать колонок полей, девятнадцать строк
 * сортов под кнопкой, и в каждой пустой клетке серый прочерк. Владелец: «слишком
 * много загажено». Теперь у цветка одна строка плиток «длина — цена» (то, что
 * задаёт прайс на деле), а исключения по сортам — коротким списком под ней,
 * ровно те, что есть. Данные и правила те же: строка «Все сорта» в таблице,
 * цена сорта перебивает её, ноль у сорта — «своей цены нет».
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
  // «Отменить» возвращает и списки особых цен: они живут в самих блоках цветков.
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
          onChange={(key, price) => {
            setValues((prev) => ({ ...prev, [key]: price }));
            setSaved(null);
          }}
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

function PriceInput({
  value,
  onChange,
  canEdit,
  label,
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  canEdit: boolean;
  label: string;
  placeholder?: string;
}) {
  if (!canEdit) {
    return (
      <div className={clsx("text-right tabular-nums", value ? "font-medium" : "text-ink-muted")}>
        {value ? `${value.toLocaleString("ru-RU")} ₸` : "—"}
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        value={value ? value.toLocaleString("ru-RU") : ""}
        placeholder={placeholder}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(parseNumber(e.target.value))}
        className={clsx(
          "w-full rounded-md border bg-surface px-2 pr-6 py-1.5 text-right text-base sm:text-sm tabular-nums",
          "focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent",
          value ? "border-line-hairline" : "border-dashed border-line-hairline bg-transparent"
        )}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">₸</span>
    </div>
  );
}

function FlowerPrices({
  flowerType,
  varieties,
  values,
  initial,
  onChange,
  canEdit,
}: {
  flowerType: string;
  varieties: string[];
  values: Record<string, number>;
  initial: Record<string, number>;
  onChange: (key: string, price: number) => void;
  canEdit: boolean;
}) {
  const grades = getGradesFor(flowerType);
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newVariety, setNewVariety] = useState("");
  const [newGrade, setNewGrade] = useState("");

  const baseFilled = grades.filter((g) => (values[priceKey(flowerType, BASE_VARIETY, g)] ?? 0) > 0).length;

  // Особые цены сортов. Список держится по тому, что было при открытии плюс
  // добавленное — а не по текущему значению: иначе строка исчезала бы из-под
  // пальца, пока человек стирает старую цену, чтобы вписать новую.
  const overrides = useMemo(() => {
    const keys = new Set<string>();
    for (const variety of varieties) {
      for (const grade of grades) {
        const key = priceKey(flowerType, variety, grade);
        if ((initial[key] ?? 0) > 0) keys.add(key);
      }
    }
    for (const key of added) keys.add(key);
    for (const key of removed) keys.delete(key);
    return Array.from(keys)
      .map((key) => {
        const [, variety, grade] = key.split("|");
        return { key, variety, grade };
      })
      .sort((a, b) => a.variety.localeCompare(b.variety, "ru") || compareGrades(flowerType, a.grade, b.grade));
  }, [varieties, grades, flowerType, initial, added, removed]);

  function addOverride() {
    if (!newVariety || !newGrade) return;
    const key = priceKey(flowerType, newVariety, newGrade);
    setRemoved((prev) => prev.filter((k) => k !== key));
    setAdded((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setAdding(false);
    setNewVariety("");
    setNewGrade("");
  }

  function removeOverride(key: string) {
    // Ноль у сорта — «своей цены нет», дальше действует общая по длине.
    onChange(key, 0);
    setRemoved((prev) => [...prev, key]);
    setAdded((prev) => prev.filter((k) => k !== key));
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}</h2>
        <span className="text-xs text-ink-muted">
          за стебель · заполнено {baseFilled} из {grades.length}
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-x-2 gap-y-2.5">
        {grades.map((grade) => {
          const key = priceKey(flowerType, BASE_VARIETY, grade);
          const value = values[key] ?? 0;
          const changed = value !== (initial[key] ?? 0);
          return (
            <label key={grade} className="block min-w-0">
              <span
                className={clsx(
                  "block truncate text-xs mb-0.5",
                  changed ? "text-accent font-medium" : value ? "text-ink-secondary" : "text-ink-muted"
                )}
                title={formatGrade(grade)}
              >
                {formatGrade(grade)}
              </span>
              <PriceInput
                value={value}
                onChange={(v) => onChange(key, v)}
                canEdit={canEdit}
                label={`Все сорта, ${formatGrade(grade)}`}
              />
            </label>
          );
        })}
      </div>

      {(overrides.length > 0 || canEdit) && (
        <div className="border-t border-line-hairline pt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Особые цены сортов
              {overrides.length === 0 && !adding && <span className="font-normal text-ink-muted"> · нет</span>}
              <Hint>
                Цена отдельного сорта перебивает общую цену по длине. Нет своей цены — действует общая.
              </Hint>
            </div>
            {canEdit && !adding && (
              <button type="button" className="text-sm text-accent hover:underline" onClick={() => setAdding(true)}>
                + Особая цена для сорта
              </button>
            )}
          </div>

          {overrides.length > 0 && (
            <ul className="divide-y divide-line-hairline">
              {overrides.map(({ key, variety, grade }) => {
                const base = values[priceKey(flowerType, BASE_VARIETY, grade)] ?? 0;
                return (
                  <li key={key} className="flex items-center gap-3 py-1.5">
                    <span className="flex-1 min-w-0 truncate text-sm">
                      {variety} <span className="text-ink-muted">· {formatGrade(grade)}</span>
                    </span>
                    {base > 0 && (
                      <span className="hidden sm:inline text-xs text-ink-muted tabular-nums">
                        общая {base.toLocaleString("ru-RU")} ₸
                      </span>
                    )}
                    <div className="w-28 shrink-0">
                      <PriceInput
                        value={values[key] ?? 0}
                        onChange={(v) => onChange(key, v)}
                        canEdit={canEdit}
                        label={`${variety}, ${formatGrade(grade)}`}
                        placeholder={base ? base.toLocaleString("ru-RU") : ""}
                      />
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeOverride(key)}
                        className="text-ink-muted hover:text-status-critical px-1"
                        aria-label={`Убрать особую цену ${variety}, ${formatGrade(grade)}`}
                        title="Убрать — будет общая цена"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canEdit && adding && (
              <div className="flex flex-wrap items-center gap-2">
                <select className="input !w-auto" value={newVariety} onChange={(e) => setNewVariety(e.target.value)}>
                  <option value="">Сорт…</option>
                  {varieties.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <select className="input !w-auto" value={newGrade} onChange={(e) => setNewGrade(e.target.value)}>
                  <option value="">Длина / категория…</option>
                  {grades.map((g) => (
                    <option key={g} value={g}>
                      {formatGrade(g)}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary" disabled={!newVariety || !newGrade} onClick={addOverride}>
                  Добавить
                </button>
                <button type="button" className="btn text-ink-secondary" onClick={() => setAdding(false)}>
                  Отмена
                </button>
              </div>
          )}
        </div>
      )}
    </section>
  );
}
